# NodeZero Lockb0x Bridge v3

This workspace is the reproducible replacement for the staging Testnet v2
Lockb0x factory workflow. It contains three Protocol 27 Soroban contracts:

- `lockb0x-bridge-verifier`: retained for dedicated verifier experiments and
  future native-host cryptography support.
- `lockb0x-bridge-factory`: Deployer-authorized, deterministic `deploy_v2`
  factory that atomically commits the provisioner-verified bridge proof hash
  and public inputs while creating a child.
- `lockb0x-bridge-account`: immutable constructor-initialized bridge record.

The factory operation is atomic: idempotent mapping lookup, immutable bridge
evidence commit, and child creation happen in one Soroban transaction. The
provisioner verifies the Groth16 proof off-chain before submitting as the
operator; generic Arkworks pairing verification exceeds the Testnet Soroban
instruction budget. The child has no public post-deployment initialization
operation.

## Required Artifact Contract

The verifier expects a canonical Arkworks compressed `VerifyingKey<Bn254>` for
the exact `pod_ownership` circuit version, plus proof bytes encoded as:

`pi_a(64) || pi_b(128) || pi_c(64)`

with public signals in the fixed order:

`claimHash, accountCommitment, podBinding`

Do not deploy this workspace until the circuit WASM, proving key, verification
key, and on-chain verifier key are generated from the same pinned artifact
manifest. The current Testnet manifest/blob mismatch must be reconciled first.

`packages/zk-crypto/scripts/compile-circuits.mjs` requires Circom 2.1.6.
The local Circom 2.2.2 output has a different WASM checksum despite matching
the pinned R1CS checksum, so it must not be used for a Testnet V3 deployment.

Convert the canonical `pod_ownership_vk.json` before deployment:

```text
cargo run --manifest-path packages/contracts/bridge-v3/Cargo.toml \
  -p nodezero-bridge-vk-encoder -- pod_ownership_vk.json pod_ownership_vk.hex
```

Pass the resulting hex file and its SHA-256 to
`scripts/stellar/deploy-lockbox-bridge-v3-testnet.sh`.