# Smart Contracts

Contract source is maintained in the Rust package and deployed to Stellar TestNet via guarded scripts.

## Current deployed TestNet contracts

- `NodeZeroIdentity`: `CCHFYOKLGVTXEYYHWEFPI22FR26VRGG2CBBUTP6XPW3ZSIWIKEVQQ44K`
- `Lockb0x`: `CB36LY5WZLJNMY4DHRXQER6LU3L4E5MGFYT2XSJG7ZJZV5SIIOKODT2H`
- `Lockb0xFactory` (v3): `CDFHCQA3YJCITWEMNLCSRGQVVFEXGTONWSQJTD5VIZO7YV4IOKZUPCGT`
- Every release-created child is audited for the exact nine immutable V3
	instance-storage fields and factory/circuit bindings.

## Files

- `packages/contracts/src/lib.rs`
- `scripts/stellar/deploy-testnet.sh`
- `deployments/stellar-testnet.contracts.json`
- `deployments/treasury-deployer.public.json`

## Deployment safeguards

- Strict testnet tuple enforcement.
- Initialization-proof gate for contract readiness.
- Non-zero failure paths for invalid deployment state.

## References

- `docs/testnet-azure-release-requirements.md`
- `docs/staging-runtime-implementation-roadmap.md`

## Credits

- Stellar Soroban platform and developer tooling underpin contract execution and deployment flows.
- NodeZero contract logic and deployment guardrails are implemented in-repo by NodeZero contributors.
- Upstream references:
	- https://developers.stellar.org/docs/smart-contracts
	- https://github.com/stellar/soroban-examples
