# ZK Crypto

The ZK package stores circuits and tooling for proof-related flows.

Current milestone scope:

- Attestation proving that a Solid WebID is linked to the signing Stellar account.
- Root anchoring in `Lockb0x` and pairing verification at sign-in.

Future scope:

- Proof-of-Humanity and nullifier-based uniqueness flows.

## Circuit assets

- `packages/zk-crypto/circuits/nullifier.circom`
- `packages/zk-crypto/circuits/poh.circom`

## Current testnet artifact evidence

- Artifact manifest: `deployments/zk-testnet-artifacts.json`
- `pod_ownership_vk.json` sha256: `8dae27b8db44d21020d3c4792e1314a8bd9ada1d2bd8d3c06d6550db29cdb68f`
- Current attestation chain target uses lockbox factory wasm hash `55bcb3a4c05ff935a421f10d1a72bdeb6e4573de8954e4fbd263f7ac88a8fbd9`.

## Scripts

- `scripts/zk/prepare-artifacts.mjs`
- `scripts/zk/prepare-testnet.sh`

## Notes

- Keep proof artifacts deterministic across environments.
- Use release policy checks before publishing artifacts to staging.
- Keep release gates aligned to current attestation scope to avoid PoH drift.
- Treat `deployments/zk-testnet-artifacts.json` as canonical for release docs and checklist updates.
