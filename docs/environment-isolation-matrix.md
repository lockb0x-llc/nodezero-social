# Environment Isolation Matrix

Date: 2026-06-24

This matrix is the source of truth for environment separation. Any cross-environment value mixing is a policy violation.

## Canonical profiles

- local
- staging-testnet
- production-mainnet

## Network and domain mapping

| Profile | Stellar RPC | Stellar Passphrase | Allowed Hosts |
|---|---|---|---|
| local | https://soroban-testnet.stellar.org | Test SDF Network ; September 2015 | localhost / local Expo hosts |
| staging-testnet | https://soroban-testnet.stellar.org | Test SDF Network ; September 2015 | `nodezero.social` public sign-in, `staging.nodezero.social` internal app, `api.nodezero.social` provisioner API, `wallet.nodezero.social` wallet broker |
| production-mainnet | https://soroban.stellar.org | Public Global Stellar Network ; September 2015 | Production-specific app/API/wallet hosts only; never inherit Testnet bindings |

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
- NZ_JSS_PROVISIONER_URL

When `NZ_BROWSER_SESSION_ENABLED=true`, strict builds additionally require:

- NZ_JSS_PROVISIONER_URL=https://api.nodezero.social
- NZ_WALLET_BROKER_URL=https://wallet.nodezero.social

Optional until the Waku messaging cutover (validated when set):

- NZ_WAKU_BOOTSTRAP_PEERS (comma-separated wss multiaddrs of NodeZero-operated
  nwaku bootstrap peers; staging and production hosts must never mix)
- NZ_WAKU_CLUSTER_ID (private Waku cluster id; default 0)

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

Waku node deploy via scripts/azure/deploy-waku.sh requires:

- AZURE_RESOURCE_GROUP
- AZURE_WAKU_NODEKEY (64-hex secret pinning the bootstrap peer id; never
  committed and never placed in a parameters file)

Optional but guarded:

- ALLOW_NON_TESTNET=1 (explicit unsafe override only)
- AUTO_FUND_SOURCE_ACCOUNT=1 (testnet account bootstrap)

## Deny rules

- staging-testnet must never use production-mainnet RPC or passphrase.
- production-mainnet must never use testnet RPC or passphrase.
- staging pipelines must use the Testnet-bound first-party host set above and
  must never target production-specific application/API/wallet hosts.
- `nodezero.social` is the public Testnet sign-in ingress while this staging
  cutover is active; it must never be paired with Mainnet RPC, passphrase, or
  contract values.
- production-mainnet deploy is not permitted from staging scripts.
- Example parameter files must never be used for real deployments.
- `staging-testnet` must not use `NZ_RELAY_URL=wss://staging.nodezero.social/relay` (or `https://.../relay`), because that path is served by the Static Web App shell and cannot terminate WebSocket signaling.
- `staging-testnet` Waku bootstrap peers must target the staging Waku host (for example, `waku-staging.nodezero.social`); production-mainnet must never reference the staging Waku host and vice versa. Strict profiles require `/wss/` transports.

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
