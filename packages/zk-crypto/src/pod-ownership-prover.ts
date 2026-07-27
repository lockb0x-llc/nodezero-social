/**
 * @module pod-ownership-prover
 * Generates Groth16 Proof of Pod Ownership proofs using snarkjs.
 */

import * as snarkjs from 'snarkjs'
import { deriveIdentity } from './identity.js'
import { poseidonHash, SNARK_FIELD_SIZE } from './poseidon.js'
import { serializeProof, serializePublicSignal } from './serializer.js'
import {
  buildPodOwnershipClaim,
  type PodOwnershipClaim,
} from './pod-ownership-claim.js'

export { buildPodOwnershipClaim, type PodOwnershipClaim } from './pod-ownership-claim.js'

const DEFAULT_WASM_PATH = 'build/pod_ownership_js/pod_ownership.wasm'
const DEFAULT_ZKEY_PATH = 'build/pod_ownership_final.zkey'
const DEFAULT_VK_PATH = 'build/pod_ownership_vk.json'

export interface PodOwnershipProofInputs {
  stellarSecretKey: string
  claim: PodOwnershipClaim
  wasmPath?: string
  zkeyPath?: string
}

export interface PodOwnershipProof {
  proof: snarkjs.Groth16Proof
  publicSignals: string[]
  canonicalClaim: string
  claimHash: bigint
  accountCommitment: bigint
  podBinding: bigint
  proofHex: string
  proofHashHex: string
  proofRootHex: string
}

async function sha256Bytes(input: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digestInput = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', digestInput)
  return new Uint8Array(digest)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

async function loadJsonArtifact(pathOrUrl: string): Promise<unknown> {
  if (/^https?:\/\//i.test(pathOrUrl) || typeof window !== 'undefined') {
    const response = await fetch(pathOrUrl)
    if (!response.ok) throw new Error(`Unable to fetch ${pathOrUrl}: ${response.status}`)
    return response.json()
  }

  const { readFile } = await import('node:fs/promises')
  return JSON.parse(await readFile(pathOrUrl, 'utf-8'))
}

export async function hashClaimToField(canonicalClaim: string): Promise<bigint> {
  const digestHex = bytesToHex(await sha256Bytes(canonicalClaim))
  return BigInt(`0x${digestHex}`) % SNARK_FIELD_SIZE
}

export async function generatePodOwnershipProof(
  inputs: PodOwnershipProofInputs
): Promise<PodOwnershipProof> {
  const canonicalClaim = buildPodOwnershipClaim(inputs.claim)
  const claimHash = await hashClaimToField(canonicalClaim)
  const { identitySecret, commitment: accountCommitment } = await deriveIdentity(inputs.stellarSecretKey)
  const podBinding = await poseidonHash([identitySecret, claimHash])

  const circuitInputs = {
    claimHash: claimHash.toString(),
    accountCommitment: accountCommitment.toString(),
    podBinding: podBinding.toString(),
    identitySecret: identitySecret.toString(),
  }

  const wasmPath = inputs.wasmPath ?? DEFAULT_WASM_PATH
  const zkeyPath = inputs.zkeyPath ?? DEFAULT_ZKEY_PATH

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInputs,
    wasmPath,
    zkeyPath
  )

  const proofBytes = serializeProof(proof)
  const signalBytes = publicSignals.map(serializePublicSignal)
  const proofHex = bytesToHex(proofBytes)
  const proofHashHex = bytesToHex(await sha256Bytes(concatBytes([proofBytes, ...signalBytes])))
  const proofRootHex = bytesToHex(await sha256Bytes(`${canonicalClaim}|${proofHashHex}`))

  return {
    proof,
    publicSignals,
    canonicalClaim,
    claimHash,
    accountCommitment,
    podBinding,
    proofHex,
    proofHashHex,
    proofRootHex,
  }
}

export async function verifyPodOwnershipProof(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[],
  vkPath: string = DEFAULT_VK_PATH
): Promise<boolean> {
  const vk = await loadJsonArtifact(vkPath)
  return snarkjs.groth16.verify(vk, publicSignals, proof)
}