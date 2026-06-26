/**
 * @module index
 * Public API for @nodezero/zk-crypto
 */

export { poseidonHash, SNARK_FIELD_SIZE } from './poseidon.js'
export { deriveIdentity, computeNullifier, nullifierToBytes32, GLOBAL_SCOPE } from './identity.js'
export { PoseidonMerkleTree } from './merkle-tree.js'
export { generatePoHProof, verifyPoHProof } from './prover.js'
export { serializeProof, serializePublicSignal, proofToSorobanArgs } from './serializer.js'

export type { Identity } from './identity.js'
export type { MerkleProof } from './merkle-tree.js'
export type { PoHProofInputs, PoHProof } from './prover.js'
