# ZK Crypto

The ZK package stores circuits and tooling for proof-related flows.

## Circuit assets

- `packages/zk-crypto/circuits/nullifier.circom`
- `packages/zk-crypto/circuits/poh.circom`

## Scripts

- `scripts/zk/prepare-artifacts.mjs`
- `scripts/zk/prepare-testnet.sh`

## Notes

- Keep proof artifacts deterministic across environments.
- Use release policy checks before publishing artifacts to staging.
