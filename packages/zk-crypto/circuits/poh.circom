pragma circom 2.1.6;

/*
 * poh.circom – Proof of Humanity Inclusion Proof
 *
 * Purpose
 * -------
 * Proves that a user's identity commitment is a member of the on-chain
 * Merkle tree (maintained by the Lockb0x contract) WITHOUT revealing:
 *   - The user's identity or public key.
 *   - Their position in the Merkle tree.
 *
 * The prover supplies:
 *   - `leaf`      : H(identitySecret)  – the user's private commitment.
 *   - `pathElements[levels]` : sibling hashes along the Merkle path.
 *   - `pathIndices[levels]`  : bit array (0 = left, 1 = right) for each level.
 *
 * The verifier supplies:
 *   - `root` : the public on-chain Merkle root (from Lockb0x.get_state_root()).
 *
 * The circuit is satisfied iff the reconstructed root equals the public root,
 * proving membership without revealing the leaf or path.
 *
 * Dependencies
 * ------------
 * circomlib (https://github.com/iden3/circomlib) must be in the include path.
 * Install with: npm install circomlib
 */

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/mux1.circom";

/*
 * MerkleTreeInclusionProof
 * Reconstructs the Merkle root from a leaf and an authentication path.
 *
 * Template parameters:
 *   levels – depth of the Merkle tree (default: 20 → up to 1M leaves).
 */
template MerkleTreeInclusionProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    component hashers[levels];
    component muxLeft[levels];
    component muxRight[levels];

    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        // pathIndices[i] == 0 → current hash is the LEFT child
        // pathIndices[i] == 1 → current hash is the RIGHT child
        muxLeft[i]  = Mux1();
        muxRight[i] = Mux1();

        muxLeft[i].c[0]  <== levelHashes[i];
        muxLeft[i].c[1]  <== pathElements[i];
        muxLeft[i].s     <== pathIndices[i];

        muxRight[i].c[0] <== pathElements[i];
        muxRight[i].c[1] <== levelHashes[i];
        muxRight[i].s    <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxLeft[i].out;
        hashers[i].inputs[1] <== muxRight[i].out;

        levelHashes[i + 1] <== hashers[i].out;
    }

    root <== levelHashes[levels];
}

/*
 * ProofOfHumanity (top-level circuit)
 *
 * Public inputs:  root, nullifier, scope
 * Private inputs: identitySecret, pathElements, pathIndices
 *
 * The circuit proves:
 *   1. leaf = Poseidon(identitySecret)
 *   2. leaf is a member of the Merkle tree with the given root
 *   3. nullifier = Poseidon(identitySecret, scope)
 *
 * The nullifier prevents the same identity from proving humanity twice
 * for the same scope (e.g. a day bucket, a vote ID) without revealing
 * which identity they are.
 */
template ProofOfHumanity(levels) {
    // ── Public inputs (known to the on-chain verifier) ─────────────────────
    signal input root;       // On-chain Merkle root from Lockb0x.get_state_root()
    signal input nullifier;  // H(identitySecret, scope) — published to prevent replay
    signal input scope;      // Domain separator (e.g. unix day, post ID)

    // ── Private inputs (never revealed) ────────────────────────────────────
    signal input identitySecret;         // The user's private identity scalar
    signal input pathElements[levels];   // Sibling hashes along the Merkle path
    signal input pathIndices[levels];    // 0 = current node is left child, 1 = right

    // ── Step 1: derive leaf commitment from identity secret ─────────────────
    component leafHasher = Poseidon(1);
    leafHasher.inputs[0] <== identitySecret;

    // ── Step 2: verify Merkle inclusion ─────────────────────────────────────
    component inclusionProof = MerkleTreeInclusionProof(levels);
    inclusionProof.leaf           <== leafHasher.out;
    inclusionProof.pathElements   <== pathElements;
    inclusionProof.pathIndices    <== pathIndices;

    // The reconstructed root MUST equal the public on-chain root.
    root === inclusionProof.root;

    // ── Step 3: verify nullifier = Poseidon(identitySecret, scope) ──────────
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== identitySecret;
    nullifierHasher.inputs[1] <== scope;
    nullifier === nullifierHasher.out;
}

// Instantiate with a 20-level tree (up to 2^20 ≈ 1M registered users).
// Public signals: root, nullifier, scope
component main { public [root, nullifier, scope] } = ProofOfHumanity(20);
