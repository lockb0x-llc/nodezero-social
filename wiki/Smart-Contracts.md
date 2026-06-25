# Smart Contracts

Contract source is maintained in the Rust package and deployed to Stellar TestNet via guarded scripts.

## Files

- `packages/contracts/src/lib.rs`
- `scripts/stellar/deploy-testnet.sh`

## Deployment safeguards

- Strict testnet tuple enforcement.
- Initialization-proof gate for contract readiness.
- Non-zero failure paths for invalid deployment state.

## References

- `docs/testnet-azure-release-requirements.md`
