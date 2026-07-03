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

## Scripts

- `scripts/zk/prepare-artifacts.mjs`
- `scripts/zk/prepare-testnet.sh`

## Notes

- Keep proof artifacts deterministic across environments.
- Use release policy checks before publishing artifacts to staging.
- Keep release gates aligned to current attestation scope to avoid PoH drift.
