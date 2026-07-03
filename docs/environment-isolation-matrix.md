# Environment Isolation Matrix

Date: 2026-06-24

This matrix is the source of truth for environment separation. Any cross-environment value mixing is a policy violation.

## Canonical profiles

- local
- staging-testnet
- production-mainnet

## Network and domain mapping

| Profile | Stellar RPC | Stellar Passphrase | Allowed Hostname |
|---|---|---|---|
| local | https://soroban-testnet.stellar.org | Test SDF Network ; September 2015 | localhost / local Expo hosts |
| staging-testnet | https://soroban-testnet.stellar.org | Test SDF Network ; September 2015 | staging.nodezero.social |
| production-mainnet | https://soroban.stellar.org | Public Global Stellar Network ; September 2015 | nodezero.social |

## Required application variables

All non-local builds must define these variables explicitly:

- NZ_ENV_PROFILE
- NZ_RELAY_URL
- NZ_STELLAR_RPC_URL
- NZ_STELLAR_NETWORK_PASSPHRASE
- NZ_IDENTITY_CONTRACT_ID
- NZ_LOCKBOX_CONTRACT_ID
- NZ_ZK_ARTIFACTS_URL
- NZ_ZK_MANIFEST_URL
- NZ_NODEZERO_ISSUER_URL
- NZ_SOLID_OIDC_ISSUER_URL
- NZ_SOLID_SIGNUP_URL

## Identity provider defaults

The Node Zero Community Server is the default identity provider in every
sign-in/signup surface. `solidcommunity.net` is a secondary option for users
with an external Solid Pod — it must never be presented as the default.

| Profile | Node Zero Community Server issuer (`NZ_NODEZERO_ISSUER_URL`) |
|---|---|
| local | https://solid.nodezero.social/ (staging server; default) |
| staging-testnet | https://solid.nodezero.social/ (default; build fails if unset) |
| production-mainnet | Must be set explicitly; never inherit the staging URL |

## Required deployment variables

Azure deployments via scripts/azure/deploy.sh require:

- AZURE_RESOURCE_GROUP
- AZURE_BICEP_PARAMETERS_FILE
- AZURE_ENVIRONMENT_NAME

Stellar TestNet deploy via scripts/stellar/deploy-testnet.sh requires:

- STELLAR_SOURCE_ACCOUNT

Optional but guarded:

- ALLOW_NON_TESTNET=1 (explicit unsafe override only)
- AUTO_FUND_SOURCE_ACCOUNT=1 (testnet account bootstrap)

## Deny rules

- staging-testnet must never use production-mainnet RPC or passphrase.
- production-mainnet must never use testnet RPC or passphrase.
- staging pipelines must never target production domain.
- production-mainnet deploy is not permitted from staging scripts.
- Example parameter files must never be used for real deployments.
- `staging-testnet` must not use `NZ_RELAY_URL=wss://staging.nodezero.social/relay` (or `https://.../relay`), because that path is served by the Static Web App shell and cannot terminate WebSocket signaling.

## CI/CD policy checkpoints

- Run policy validator before lint/test/deploy.
- Require what-if preflight before Azure apply.
- Require environment coherence between profile and parameter file.
- Require manual approval for production environment workflows.

## Ownership and approval

- PROJECT_MANAGER owns policy updates.
- AZURE_PLATFORM_AGENT validates cloud-side enforcement.
- STELLAR_CONTRACT_AGENT validates chain-side enforcement.
- QA_RELEASE_AGENT signs off the matrix in release evidence.
