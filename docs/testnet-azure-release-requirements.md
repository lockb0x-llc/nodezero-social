# NodeZero TestNet release requirements (Stellar Protocol 27.x + Azure)

This document defines the required order and prerequisites to release NodeZero.social on Stellar TestNet and Azure.

## Foundational environment isolation policy

The following are non-optional guardrails for every deployment:

- Environment profiles are explicit: `local`, `staging-testnet`, `production-mainnet`.
- Cross-environment references are denied by default.
   - Staging/TestNet must not reference MainNet RPC, passphrase, contracts, domains, or secrets.
   - Production/MainNet must not reference TestNet RPC, passphrase, contracts, domains, or secrets.
- Staging deploys must target `staging.nodezero.social`.
- Deployments must run a preflight validation (`what-if`) before apply.
- Production/MainNet release must use a dedicated protected workflow and is not permitted from staging scripts.

## Authoritative Stellar references

- Setup and environment: https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup
- Deploy to TestNet: https://developers.stellar.org/docs/build/smart-contracts/getting-started/deploy-to-testnet
- Network software versions: https://developers.stellar.org/docs/networks/software-versions

## Required toolchain (Protocol 27.x target)

- Rust toolchain supporting `wasm32v1-none`
- Stellar CLI `27.x`
- Soroban/TestNet passphrase: `Test SDF Network ; September 2015`
- TestNet RPC endpoint (default in this repo): `https://soroban-testnet.stellar.org`
- Azure CLI with Bicep support
- `pnpm`, `jq`, and Node.js (for artifact manifests)

## Release sequence

1. Prepare ZK circuits and artifact manifest:
   - `pnpm prepare:zk:testnet`
   - Output: `/home/runner/work/nodezero-social/nodezero-social/deployments/zk-testnet-artifacts.json`
2. Deploy Soroban contracts to Stellar TestNet:
   - `STELLAR_SOURCE_ACCOUNT=<alias> pnpm deploy:stellar:testnet`
   - Output: `/home/runner/work/nodezero-social/nodezero-social/deployments/stellar-testnet.contracts.json`
   - Manifest now includes per-contract `deploymentMode` (`created` or `reused`) to support idempotency auditing.
3. Update app deployment variables with new values:
   - `NZ_IDENTITY_CONTRACT_ID`
   - `NZ_LOCKBOX_CONTRACT_ID`
   - `NZ_ZK_ARTIFACTS_URL`
   - `NZ_ZK_MANIFEST_URL`
   - Optional network overrides:
     - `NZ_STELLAR_RPC_URL`
     - `NZ_STELLAR_NETWORK_PASSPHRASE`
4. Provision Azure infrastructure:
   - Copy `infrastructure/azure/main.parameters.example.json` to a secure parameters file.
   - Inject contract IDs and ZK URLs from deployment outputs.
   - Run `AZURE_RESOURCE_GROUP=<rg-name> AZURE_BICEP_PARAMETERS_FILE=<secure-file> AZURE_ENVIRONMENT_NAME=staging-testnet pnpm deploy:azure`
5. Publish the app (Expo web build) to Azure Static Web App using the provisioned hostname.

## Contract and artifact handoff to application

The mobile app now reads TestNet deployment values from `packages/mobile-app/app.config.js`:

- `extra.identityContractId`
- `extra.lockboxContractId`
- `extra.zkArtifactsUrl`
- `extra.zkManifestUrl`
- `extra.stellarRpcUrl`
- `extra.stellarNetworkPassphrase`

`WalletContext.registerIdentity()` uses `NZ_IDENTITY_CONTRACT_ID` by default if no explicit contract ID is passed.
