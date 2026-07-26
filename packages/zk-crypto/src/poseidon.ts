/**
 * @module poseidon
 * Thin wrapper around circomlibjs Poseidon for consistent use across the library.
 * Poseidon is a ZK-friendly hash function designed for use inside arithmetic circuits.
 */

import { buildPoseidon as buildPoseidonNative } from 'circomlibjs/src/poseidon_wasm.js'

export type PoseidonFn = {
  (inputs: bigint[]): Uint8Array
  F: { toObject(v: Uint8Array): bigint; e(v: bigint): Uint8Array }
}

let _poseidon: PoseidonFn | null = null

export async function getPoseidon(): Promise<PoseidonFn> {
  if (!_poseidon) {
    _poseidon = await buildPoseidonNative() as PoseidonFn
  }
  return _poseidon
}

/** Hash one or two field elements using Poseidon. Returns a bigint. */
export async function poseidonHash(inputs: bigint[]): Promise<bigint> {
  const poseidon = await getPoseidon()
  const result = poseidon(inputs.map(BigInt))
  return poseidon.F.toObject(result)
}

/** The BN254 scalar field size (used for modular arithmetic). */
export const SNARK_FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n
