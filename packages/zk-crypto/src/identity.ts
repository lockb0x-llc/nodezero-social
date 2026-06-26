/**
 * @module identity
 * Derives a ZK identity (secret scalar + leaf commitment) from a Stellar secret key.
 *
 * The identity secret is deterministic — the same Stellar key always produces
 * the same ZK identity.  The commitment (leaf) is H_poseidon(identitySecret)
 * and is stored in the Merkle tree managed by the Lockb0x oracle.
 */

import { SNARK_FIELD_SIZE, poseidonHash } from './poseidon.js'

export interface Identity {
  /** Private: never share or store on-chain. */
  identitySecret: bigint
  /** Public: this is the Merkle tree leaf stored in Lockb0x. */
  commitment: bigint
}

/**
 * Derives a ZK identity from a Stellar secret key string (S…).
 * The derivation is: identitySecret = keccak256(stellarKey) mod SNARK_FIELD_SIZE
 * The commitment is: Poseidon(identitySecret)
 */
export async function deriveIdentity(stellarSecretKey: string): Promise<Identity> {
  // Use first 31 bytes of the key bytes (avoids field overflow before mod)
  const encoded = new TextEncoder().encode(stellarSecretKey)
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded)
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const identitySecret = BigInt('0x' + hashHex) % SNARK_FIELD_SIZE

  const commitment = await poseidonHash([identitySecret])

  return { identitySecret, commitment }
}

/**
 * Computes the nullifier for an identity + scope combination.
 * nullifier = Poseidon(identitySecret, scope)
 */
export async function computeNullifier(
  identitySecret: bigint,
  scope: bigint
): Promise<bigint> {
  return poseidonHash([identitySecret, scope])
}

/** Converts a nullifier bigint to a 32-byte hex string (for Soroban). */
export function nullifierToBytes32(nullifier: bigint): string {
  return nullifier.toString(16).padStart(64, '0')
}

/** A scope = 0n means "global, one proof per identity ever". Good for hackathon. */
export const GLOBAL_SCOPE = 0n
