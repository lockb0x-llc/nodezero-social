/**
 * @module index
 * Public API for @nodezero/zk-crypto
 */

export { poseidonHash, SNARK_FIELD_SIZE } from './poseidon.js'
export { deriveIdentity, computeNullifier, nullifierToBytes32, GLOBAL_SCOPE } from './identity.js'
export { PoseidonMerkleTree } from './merkle-tree.js'
export { generatePoHProof, verifyPoHProof } from './prover.js'
export {
	buildPodOwnershipClaim,
	generatePodOwnershipProof,
	hashClaimToField,
	verifyPodOwnershipProof,
} from './pod-ownership-prover.js'
export { serializeProof, serializePublicSignal, proofToSorobanArgs } from './serializer.js'

export {
	encryptAttestation,
	decryptAttestation,
	verifyLoginAttestation,
	fieldToBytes32Hex,
	deriveAccountCommitmentHex,
} from './attestation-cipher.js'

export type { Identity } from './identity.js'
export type { MerkleProof } from './merkle-tree.js'
export type { PoHProofInputs, PoHProof } from './prover.js'
export type { PodOwnershipClaim, PodOwnershipProofInputs, PodOwnershipProof } from './pod-ownership-prover.js'
export type {
	EncryptedAttestation,
	LoginAttestationInput,
	LoginAttestationResult,
} from './attestation-cipher.js'
