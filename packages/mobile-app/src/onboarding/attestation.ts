/**
 * @module onboarding/attestation
 *
 * Client-side production of the real Pod-ownership attestation (Phase D).
 *
 * Runs entirely on-device using the embedded Stellar secret (same trust
 * boundary as signing): it derives the ZK identity, generates a `pod_ownership`
 * Groth16 proof binding the WebID/Pod/Stellar/contract claim, and encrypts the
 * canonical claim under a Stellar-derived AES-256-GCM key for on-chain +
 * in-Pod recovery.
 *
 * The provisioner anchors the returned `accountCommitment` + `ciphertext` in the
 * user's Lockb0x (`set_attestation`). Login / return / peer checks later verify
 * the proof off-chain against that on-chain anchor (see zk-crypto
 * `verifyLoginAttestation`).
 */

import Constants from 'expo-constants'
import type { PodOwnershipClaim } from '@nodezero/zk-crypto/pod-ownership'

/**
 * Fixed placeholders for the seamless (non-interactive) attestation claim. The
 * seamless flow has no server challenge, so these constants stand in for the
 * challenge fields. Both prover (here) and verifier (return login / peer) use
 * the same values so `claimHash` is reproducible from Pod facts alone.
 */
const SEAMLESS_CHALLENGE_ID = 'nz-seamless-v1'
const SEAMLESS_NONCE = 'nz-seamless-v1'
const SEAMLESS_EXPIRES_AT = 'nz-seamless-v1'

interface AttestationConfig {
  envProfile: string
  stellarNetworkPassphrase: string
  identityContractId: string
  lockboxFactoryContractId: string
  zkArtifactsUrl: string
}

function getConfig(): AttestationConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>
  return {
    envProfile: extra.envProfile ?? 'local',
    stellarNetworkPassphrase: extra.stellarNetworkPassphrase ?? '',
    identityContractId: extra.identityContractId ?? '',
    lockboxFactoryContractId: extra.lockboxFactoryContractId ?? '',
    zkArtifactsUrl: (extra.zkArtifactsUrl ?? '').replace(/\/+$/, ''),
  }
}

export interface SeamlessAttestationInput {
  /** The WebID returned by the provisioner (authoritative). */
  webId: string
  /** The Pod URL returned by the provisioner. */
  podUrl: string
  /** The member's Stellar public key (G...). */
  stellarPublicKey: string
  /** The embedded wallet secret (S...), used in-process for proof + encryption. */
  stellarSecret: string
}

export interface SeamlessAttestation {
  /** 32-byte hex `Poseidon(identitySecret)` — the on-chain identity anchor. */
  accountCommitmentHex: string
  /** Hex of the AES-256-GCM encrypted canonical claim (on-chain + Pod). */
  ciphertextHex: string
  /** SHA-256 of the ciphertext bytes, hex. */
  ciphertextSha256Hex: string
  /** [claimHash, accountCommitment, podBinding] decimal field elements. */
  publicSignals: string[]
  /** The claim that was proven and encrypted (for the Pod slot / return verify). */
  claim: PodOwnershipClaim
}

/**
 * Builds the canonical Pod-ownership claim from configuration + the provisioned
 * WebID/Pod. Both the prover and the verifier reconstruct this identically.
 */
export function buildSeamlessClaim(input: {
  webId: string
  podUrl: string
  stellarPublicKey: string
}): PodOwnershipClaim {
  const config = getConfig()
  return {
    envProfile: config.envProfile,
    stellarNetworkPassphrase: config.stellarNetworkPassphrase,
    webId: input.webId.trim(),
    podUrl: input.podUrl.trim(),
    stellarPublicKey: input.stellarPublicKey.trim(),
    identityContractId: config.identityContractId,
    lockboxFactoryContractId: config.lockboxFactoryContractId,
    challengeId: SEAMLESS_CHALLENGE_ID,
    nonce: SEAMLESS_NONCE,
    expiresAt: SEAMLESS_EXPIRES_AT,
  }
}

/**
 * Produces the on-device attestation: a `pod_ownership` Groth16 proof plus the
 * Stellar-encrypted claim ciphertext. Throws if ZK artifacts are unconfigured.
 */
export async function produceSeamlessAttestation(
  input: SeamlessAttestationInput,
): Promise<SeamlessAttestation> {
  const config = getConfig()
  if (!config.zkArtifactsUrl) {
    throw new Error('ZK artifacts URL is not configured (NZ_ZK_ARTIFACTS_URL).')
  }

  const claim = buildSeamlessClaim(input)

  // The ZK stack (snarkjs/circomlibjs/ffjavascript) relies on Node's `Buffer`.
  // Expo web does not guarantee a global Buffer in deferred chunks, so ensure it
  // is polyfilled before loading/using the proving code.
  const globalRef = globalThis as unknown as { Buffer?: unknown }
  if (typeof globalRef.Buffer === 'undefined') {
    const bufferModule = await import('buffer')
    globalRef.Buffer = bufferModule.Buffer
  }

  // Dynamically import the heavy ZK stack (snarkjs/circomlibjs) so it is a
  // deferred chunk loaded only when the user creates a node — keeping it out of
  // the app-boot bundle (avoids eager-load Buffer crashes on Expo web).
  const { buildPodOwnershipClaim, generatePodOwnershipProof } = await import('@nodezero/zk-crypto/pod-ownership')
  const { encryptAttestation, fieldToBytes32Hex } = await import('@nodezero/zk-crypto/attestation-cipher')

  const canonicalClaim = buildPodOwnershipClaim(claim)

  const proof = await generatePodOwnershipProof({
    stellarSecretKey: input.stellarSecret,
    claim,
    wasmPath: `${config.zkArtifactsUrl}/pod_ownership_js/pod_ownership.wasm`,
    zkeyPath: `${config.zkArtifactsUrl}/pod_ownership_final.zkey`,
  })

  const encrypted = await encryptAttestation(canonicalClaim, input.stellarSecret)

  return {
    accountCommitmentHex: fieldToBytes32Hex(proof.accountCommitment.toString()),
    ciphertextHex: encrypted.hex,
    ciphertextSha256Hex: encrypted.sha256Hex,
    publicSignals: proof.publicSignals,
    claim,
  }
}
