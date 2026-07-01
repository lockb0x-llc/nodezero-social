/**
 * @module attestation-cipher
 *
 * Stellar-derived encryption of the canonical Pod-ownership attestation claim,
 * plus off-chain login verification of the `pod_ownership` Groth16 proof.
 *
 * ## Encryption (recovery)
 * The attestation claim string is encrypted with AES-256-GCM under a key derived
 * from the member's Stellar secret via HKDF-SHA256. Only the holder of that
 * Stellar key can re-derive the key and decrypt. The ciphertext is stored both
 * on-chain (in the `Lockb0x`) and in the user's Pod, and is used only when a Pod
 * needs to be recovered — the contract never sees the plaintext.
 *
 * Wire format (bytes):  version(1) || nonce(12) || AES-GCM ciphertext+tag
 *
 * ## Login verification (auth)
 * At login / on return / peer-to-peer, the relying party verifies the
 * `pod_ownership` proof off-chain with snarkjs and cross-checks:
 *   1. the proof is valid,
 *   2. its `claimHash` equals `H(claim)` rebuilt from the Pod's own facts,
 *   3. its `accountCommitment` equals the value anchored in the on-chain Lockb0x.
 *
 * Only Web Crypto (`crypto.subtle`) is used, so this runs unchanged in the Expo
 * web bundle and in Node (tests / provisioner-side tooling).
 */

import {
  buildPodOwnershipClaim,
  hashClaimToField,
  verifyPodOwnershipProof,
  type PodOwnershipClaim,
} from './pod-ownership-prover.js'
import { deriveIdentity } from './identity.js'
import type * as snarkjs from 'snarkjs'

const CIPHER_VERSION = 0x01
const GCM_NONCE_BYTES = 12
const HKDF_INFO = 'NZ_ATTEST_ENC_V1'
const HKDF_SALT = 'NZ_ATTEST_SALT_V1'

// ── byte helpers ────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase().replace(/^0x/, '')
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    throw new Error('Invalid hex string.')
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return toHex(new Uint8Array(digest))
}

async function deriveAesKey(stellarSecretKey: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const ikm = enc.encode(stellarSecretKey.trim())
  const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(HKDF_SALT), info: enc.encode(HKDF_INFO) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export interface EncryptedAttestation {
  /** Raw wire bytes: version(1) || nonce(12) || ciphertext+tag. */
  bytes: Uint8Array
  /** Lowercase hex of `bytes` — used for on-chain `Bytes` storage and transport. */
  hex: string
  /** SHA-256 of `bytes`, hex. Bind this into the canonical claim so the proof commits to the ciphertext. */
  sha256Hex: string
}

/**
 * Encrypts the canonical attestation claim under a Stellar-derived AES-256-GCM key.
 */
export async function encryptAttestation(
  canonicalClaim: string,
  stellarSecretKey: string,
): Promise<EncryptedAttestation> {
  const key = await deriveAesKey(stellarSecretKey)
  const nonce = crypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES))
  const plaintext = new TextEncoder().encode(canonicalClaim)
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext))

  const bytes = new Uint8Array(1 + GCM_NONCE_BYTES + sealed.length)
  bytes[0] = CIPHER_VERSION
  bytes.set(nonce, 1)
  bytes.set(sealed, 1 + GCM_NONCE_BYTES)

  return { bytes, hex: toHex(bytes), sha256Hex: await sha256Hex(bytes) }
}

/**
 * Decrypts an attestation ciphertext produced by {@link encryptAttestation}.
 * Accepts the raw bytes or their hex encoding. Throws on tamper (GCM auth fail)
 * or wrong key.
 */
export async function decryptAttestation(
  blob: Uint8Array | string,
  stellarSecretKey: string,
): Promise<string> {
  const bytes = typeof blob === 'string' ? fromHex(blob) : blob
  if (bytes.length < 1 + GCM_NONCE_BYTES + 16) {
    throw new Error('Attestation ciphertext is too short.')
  }
  if (bytes[0] !== CIPHER_VERSION) {
    throw new Error(`Unsupported attestation ciphertext version: ${bytes[0]}.`)
  }
  const nonce = bytes.slice(1, 1 + GCM_NONCE_BYTES)
  const sealed = bytes.slice(1 + GCM_NONCE_BYTES)
  const key = await deriveAesKey(stellarSecretKey)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed)
  return new TextDecoder().decode(plaintext)
}

// ── login verification ──────────────────────────────────────────────────────

export interface LoginAttestationInput {
  proof: snarkjs.Groth16Proof
  /** [claimHash, accountCommitment, podBinding] as decimal field-element strings. */
  publicSignals: string[]
  /** The claim the verifier rebuilds independently from the Pod's own facts. */
  claim: PodOwnershipClaim
  /** The identity anchor read from the on-chain Lockb0x (`get_account_commitment`), as 32-byte hex. */
  onchainAccountCommitmentHex: string
  /** Verifying key path/URL (defaults to the bundled pod_ownership vk). */
  vkPath?: string
}

export interface LoginAttestationResult {
  valid: boolean
  reason?: string
}

/**
 * Verifies a `pod_ownership` login proof off-chain and binds it to the Pod claim
 * and the on-chain identity anchor. Fail-closed: returns `{ valid: false, reason }`
 * on any mismatch.
 */
export async function verifyLoginAttestation(
  input: LoginAttestationInput,
): Promise<LoginAttestationResult> {
  if (!Array.isArray(input.publicSignals) || input.publicSignals.length !== 3) {
    return { valid: false, reason: 'publicSignals must be [claimHash, accountCommitment, podBinding].' }
  }

  // 1. The Groth16 proof itself must verify.
  const proofOk = await verifyPodOwnershipProof(input.proof, input.publicSignals, input.vkPath)
  if (!proofOk) {
    return { valid: false, reason: 'Groth16 proof verification failed.' }
  }

  // 2. claimHash must equal H(claim) rebuilt from the Pod's own facts.
  const canonicalClaim = buildPodOwnershipClaim(input.claim)
  const expectedClaimHash = await hashClaimToField(canonicalClaim)
  if (BigInt(input.publicSignals[0]) !== expectedClaimHash) {
    return { valid: false, reason: 'Proof claimHash does not match the Pod-derived claim.' }
  }

  // 3. accountCommitment must equal the anchor stored on-chain in the Lockb0x.
  let onchain: bigint
  try {
    onchain = BigInt(`0x${input.onchainAccountCommitmentHex.trim().replace(/^0x/, '')}`)
  } catch {
    return { valid: false, reason: 'On-chain accountCommitment is not valid hex.' }
  }
  if (BigInt(input.publicSignals[1]) !== onchain) {
    return { valid: false, reason: 'Proof accountCommitment does not match the on-chain anchor.' }
  }

  return { valid: true }
}

/** Converts a public-signal decimal field element (e.g. accountCommitment) to 32-byte hex for on-chain storage. */
export function fieldToBytes32Hex(decimalFieldElement: string): string {
  return BigInt(decimalFieldElement).toString(16).padStart(64, '0')
}

/**
 * Derives the ZK identity anchor `Poseidon(identitySecret)` from a Stellar
 * secret and returns it as 32-byte hex — the value the on-chain Lockb0x stores
 * via `get_account_commitment`. Used on returning login to prove the device
 * still controls the anchored identity (compare against the on-chain value).
 */
export async function deriveAccountCommitmentHex(stellarSecretKey: string): Promise<string> {
  const { commitment } = await deriveIdentity(stellarSecretKey)
  return commitment.toString(16).padStart(64, '0')
}
