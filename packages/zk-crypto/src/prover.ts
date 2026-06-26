/**
 * @module prover
 * Generates Groth16 Proof of Humanity proofs using snarkjs.
 *
 * The proof proves (in ZK) that:
 *   1. The prover knows an identitySecret whose Poseidon hash is a leaf in the tree.
 *   2. The nullifier was computed correctly from identitySecret and scope.
 *
 * Nothing about identitySecret is revealed in the proof's public outputs.
 */

import * as snarkjs from 'snarkjs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MerkleProof } from './merkle-tree.js'
import { computeNullifier } from './identity.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BUILD_DIR = path.resolve(__dirname, '..', 'build')

export interface PoHProofInputs {
  identitySecret: bigint
  merkleProof: MerkleProof
  scope: bigint
}

export interface PoHProof {
  /** Groth16 proof object (pi_a, pi_b, pi_c). */
  proof: snarkjs.Groth16Proof
  /** Public signals: [root, nullifier, scope] as bigint strings. */
  publicSignals: string[]
  /** The nullifier as bigint (= Poseidon(identitySecret, scope)). */
  nullifier: bigint
  /** The Merkle root used. */
  root: bigint
  /** The scope used. */
  scope: bigint
}

/**
 * Generates a Groth16 Proof of Humanity.
 *
 * Requires the circuit to have been compiled and trusted setup run:
 *   pnpm run build:circuits && pnpm run build:setup
 */
export async function generatePoHProof(inputs: PoHProofInputs): Promise<PoHProof> {
  const { identitySecret, merkleProof, scope } = inputs
  const nullifier = await computeNullifier(identitySecret, scope)

  const circuitInputs = {
    // Public
    root: merkleProof.root.toString(),
    nullifier: nullifier.toString(),
    scope: scope.toString(),
    // Private
    identitySecret: identitySecret.toString(),
    pathElements: merkleProof.pathElements.map(String),
    pathIndices: merkleProof.pathIndices,
  }

  const wasmPath = path.join(BUILD_DIR, 'poh_js', 'poh.wasm')
  const zkeyPath = path.join(BUILD_DIR, 'poh_final.zkey')

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInputs,
    wasmPath,
    zkeyPath
  )

  return {
    proof,
    publicSignals,
    nullifier,
    root: merkleProof.root,
    scope,
  }
}

/**
 * Verifies a PoH proof locally (without Soroban).
 * Useful for testing before deploying on-chain.
 */
export async function verifyPoHProof(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[]
): Promise<boolean> {
  const vkPath = path.join(BUILD_DIR, 'poh_vk.json')
  const vk = JSON.parse(await readFile(vkPath, 'utf-8'))
  return snarkjs.groth16.verify(vk, publicSignals, proof)
}
