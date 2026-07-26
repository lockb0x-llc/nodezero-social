/**
 * @module serializer
 * Converts snarkjs Groth16 proof objects into the byte format expected
 * by the Soroban PoHVerifier contract.
 *
 * Groth16 on BN254:
 *   pi_a  : G1 point → 64 bytes  (x: 32, y: 32)
 *   pi_b  : G2 point → 128 bytes (x0: 32, x1: 32, y0: 32, y1: 32)
 *   pi_c  : G1 point → 64 bytes  (x: 32, y: 32)
 *   Total : 256 bytes
 *
 * Public signals layout (each 32 bytes, big-endian):
 *   [0] root      — on-chain Merkle root
 *   [1] nullifier — H(identitySecret, scope)
 *   [2] scope     — domain separator
 */

import type { Groth16Proof } from 'snarkjs'

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function g1ToBytes(point: string[]): Uint8Array {
  const out = new Uint8Array(64)
  out.set(bigintToBytes32(BigInt(point[0])), 0)
  out.set(bigintToBytes32(BigInt(point[1])), 32)
  return out
}

function g2ToBytes(point: string[][]): Uint8Array {
  // point = [[x0, x1], [y0, y1]]
  const out = new Uint8Array(128)
  out.set(bigintToBytes32(BigInt(point[0][0])), 0)
  out.set(bigintToBytes32(BigInt(point[0][1])), 32)
  out.set(bigintToBytes32(BigInt(point[1][0])), 64)
  out.set(bigintToBytes32(BigInt(point[1][1])), 96)
  return out
}

/**
 * Serializes a Groth16 proof to 256 bytes for the Soroban contract.
 * Layout: pi_a(64) || pi_b(128) || pi_c(64)
 */
export function serializeProof(proof: Groth16Proof): Uint8Array {
  const piA = g1ToBytes(proof.pi_a as string[])
  const piB = g2ToBytes(proof.pi_b as string[][])
  const piC = g1ToBytes(proof.pi_c as string[])

  const out = new Uint8Array(256)
  out.set(piA, 0)
  out.set(piB, 64)
  out.set(piC, 192)
  return out
}

/**
 * Serializes a public signal (bigint string) to 32 bytes.
 */
export function serializePublicSignal(signal: string): Uint8Array {
  return bigintToBytes32(BigInt(signal))
}

/**
 * Produces the hex-encoded strings ready for Stellar SDK xdr.ScVal.scvBytes().
 */
export function proofToSorobanArgs(
  proof: Groth16Proof,
  publicSignals: string[]
): { proofHex: string; rootHex: string; nullifierHex: string; scopeHex: string } {
  const proofBytes = serializeProof(proof)
  const rootBytes = serializePublicSignal(publicSignals[0])
  const nullifierBytes = serializePublicSignal(publicSignals[1])
  const scopeBytes = serializePublicSignal(publicSignals[2])

  return {
    proofHex: bytesToHex(proofBytes),
    rootHex: bytesToHex(rootBytes),
    nullifierHex: bytesToHex(nullifierBytes),
    scopeHex: bytesToHex(scopeBytes),
  }
}

/**
 * Encodes the `pod_ownership` circuit output for the atomic Lockb0x Bridge
 * Factory v3 verifier. The circuit's public-signal order is fixed as
 * claimHash, accountCommitment, podBinding.
 */
export function podOwnershipProofToBridgeArgs(
  proof: Groth16Proof,
  publicSignals: string[]
): {
  proofHex: string
  claimHashHex: string
  accountCommitmentHex: string
  podBindingHex: string
} {
  if (publicSignals.length !== 3) {
    throw new Error('pod_ownership proof must contain claimHash, accountCommitment, and podBinding.')
  }

  return {
    proofHex: bytesToHex(serializeProof(proof)),
    claimHashHex: bytesToHex(serializePublicSignal(publicSignals[0])),
    accountCommitmentHex: bytesToHex(serializePublicSignal(publicSignals[1])),
    podBindingHex: bytesToHex(serializePublicSignal(publicSignals[2])),
  }
}
