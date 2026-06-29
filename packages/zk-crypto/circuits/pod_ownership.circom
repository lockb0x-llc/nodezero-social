pragma circom 2.1.6;

/*
 * pod_ownership.circom - Proof of Pod Ownership
 *
 * Proves that the holder of the Stellar-derived identity secret created a
 * binding for a canonical Solid Pod/WebID ownership claim.
 *
 * Public inputs:
 *   claimHash          - field element derived from the canonical claim bytes
 *   accountCommitment  - Poseidon(identitySecret)
 *   podBinding         - Poseidon(identitySecret, claimHash)
 *
 * Private input:
 *   identitySecret     - scalar derived from the embedded Stellar secret key
 */

include "node_modules/circomlib/circuits/poseidon.circom";

template ProofOfPodOwnership() {
    signal input claimHash;
    signal input accountCommitment;
    signal input podBinding;

    signal input identitySecret;

    component accountHasher = Poseidon(1);
    accountHasher.inputs[0] <== identitySecret;
    accountCommitment === accountHasher.out;

    component bindingHasher = Poseidon(2);
    bindingHasher.inputs[0] <== identitySecret;
    bindingHasher.inputs[1] <== claimHash;
    podBinding === bindingHasher.out;
}

component main { public [claimHash, accountCommitment, podBinding] } = ProofOfPodOwnership();