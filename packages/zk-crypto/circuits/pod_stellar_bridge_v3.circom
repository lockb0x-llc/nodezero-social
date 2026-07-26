pragma circom 2.2.2;

/*
 * pod_stellar_bridge_v3.circom
 *
 * V3 bridge proof. The canonical claim is domain-separated off-circuit as
 * NZ_POD_STELLAR_BRIDGE_V3 and commits to the Testnet factory, Pod/WebID, and
 * Stellar identity. The circuit proves a single Stellar-derived identity
 * secret controls both public identity commitments.
 *
 * Public inputs, in this exact order:
 *   claimHash, accountCommitment, podBinding
 */

include "node_modules/circomlib/circuits/poseidon.circom";

template PodStellarBridgeV3() {
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

component main { public [claimHash, accountCommitment, podBinding] } = PodStellarBridgeV3();