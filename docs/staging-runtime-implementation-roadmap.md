# Staging / TestNet Runtime Implementation Roadmap

**Environment:** `staging-testnet`
**Resource group:** `rg-nodezero-social-staging-testnet`
**Subscription:** `<AZURE_SUBSCRIPTION_ID>` — see [`docs/dev-only/azure-identity.md`](dev-only/azure-identity.md) (gitignored)
**Public URL:** `https://staging.nodezero.social`
**Chain:** Stellar TestNet (`Test SDF Network ; September 2015`)
**Document status:** Living — update status column and date after each change.
**Last verified:** 2026-06-30 (Azure Resource Graph live query + repo analysis)

> **Operator note:** Azure Subscription ID, Tenant ID, service principal Client ID, and generated storage/ACA hostnames are stored in the gitignored internal reference file [`docs/dev-only/azure-identity.md`](dev-only/azure-identity.md). That file must never be committed. Runtime secrets are managed via GitHub environment secrets and Azure Key Vault.

---

## Purpose

This document is the single source of truth for tracking:

1. Every Azure resource in the staging resource group, its role, and its current state.
2. Which CI/CD artifact or deployment script owns each resource.
3. Which application function or feature depends on each resource.
4. Outstanding implementation gaps and the work needed to close them.
5. The delta between the staging-testnet footprint and the future `production-mainnet` footprint at `app.nodezero.social`.

It complements (does not replace) the [staging UAT checklist](staging-uat-checklist.md) and
[environment isolation matrix](environment-isolation-matrix.md).

---

## 1. Live Resource Inventory

Source: Azure Resource Graph query against `rg-nodezero-social-staging-testnet` on 2026-06-30.
Full resource count: **14 resources**.

### 1.1 Web / Hosting plane

| # | Resource name | Azure type | Provisioning owner | Status |
|---|---|---|---|---|
| W1 | `nodezero-social-staging-testnet-web` | `microsoft.web/staticsites` | [main.bicep](../infrastructure/azure/main.bicep) via [staging-deploy.yml](../.github/workflows/staging-deploy.yml) | ✅ Active — serves `staging.nodezero.social` |

### 1.2 Service / API plane

| # | Resource name | Azure type | Provisioning owner | Status |
|---|---|---|---|---|
| S1 | `nodezero-social-staging-testnet-provisioner` | `microsoft.web/sites` | [staging-deploy.yml](../.github/workflows/staging-deploy.yml) — `az webapp deploy` step | ✅ Active — last successful start 2026-06-29 |
| S2 | `nodezero-social-staging-testnet-relay` | `microsoft.web/sites` | **Not codified in current IaC/workflows** — provisioned manually or via ad-hoc script | ✅ Active — confirmed healthy `/health` 2026-06-27 |
| S3 | `asp-nodezero-staging-relay` | `microsoft.web/serverfarms` | **Not codified in current IaC/workflows** — bound to S2 | ✅ Active — App Service plan for relay |

### 1.3 Solid / Identity-data plane

| # | Resource name | Azure type | Provisioning owner | Status |
|---|---|---|---|---|
| I1 | `nz-staging-testnet-solid` | `microsoft.app/containerapps` | [solid-server.bicep](../infrastructure/azure/solid-server.bicep) via [redeploy-solid-server.yml](../.github/workflows/redeploy-solid-server.yml) | ✅ Active — CSS 7.1.9 at `nz-staging-testnet-solid.calmwater-b7429d4d.eastus2.azurecontainerapps.io` |
| I2 | `nodezero-social-staging-testnet-solid-env` | `microsoft.app/managedenvironments` | [solid-server.bicep](../infrastructure/azure/solid-server.bicep) | ✅ Active — ACA managed environment |
| I3 | `solid-nodezero-social-cert` | `microsoft.app/managedenvironments/managedcertificates` | [redeploy-solid-server.sh](../scripts/azure/redeploy-solid-server.sh) — cert auto-provisioned for custom host | ✅ Active — managed cert for `solid.nodezero.social` |
| I4 | `stsolidzfjw3yqgsg26g` | `microsoft.storage/storageaccounts` | [solid-server.bicep](../infrastructure/azure/solid-server.bicep) | ✅ Active — Azure Files SMB share backing CSS `/data` Pod storage |
| I5 | `nodezero-social-staging-testnet-solid-law` | `microsoft.operationalinsights/workspaces` | [solid-server.bicep](../infrastructure/azure/solid-server.bicep) | ✅ Active — isolated log workspace for Solid stack |

### 1.4 Observability plane

| # | Resource name | Azure type | Provisioning owner | Status |
|---|---|---|---|---|
| O1 | `nodezero-social-staging-testnet-appi` | `microsoft.insights/components` | [main.bicep](../infrastructure/azure/main.bicep) | ✅ Active — App Insights (workspace-based, kind=web) |
| O2 | `nodezero-social-staging-testnet-law` | `microsoft.operationalinsights/workspaces` | [main.bicep](../infrastructure/azure/main.bicep) | ✅ Active — primary staging Log Analytics workspace |

### 1.5 Security / secrets plane

| # | Resource name | Azure type | Provisioning owner | Status |
|---|---|---|---|---|
| K1 | `nodezerosocialstagingtes` | `microsoft.keyvault/vaults` | [main.bicep](../infrastructure/azure/main.bicep) — RBAC-enabled | ✅ Active — holds contract IDs + ZK URLs |

### 1.6 Storage / artifacts plane

| # | Resource name | Azure type | Provisioning owner | Status |
|---|---|---|---|---|
| A1 | `stki7yquyjmnskg` | `microsoft.storage/storageaccounts` | [main.bicep](../infrastructure/azure/main.bicep) | ✅ Active — ZK artifacts blob (`zk-artifacts/` container) |

### 1.7 DNS plane

| # | Resource name | Azure type | Provisioning owner | Status |
|---|---|---|---|---|
| D1 | `nodezero.social` | `microsoft.network/dnszones` | [main.bicep](../infrastructure/azure/main.bicep) | ✅ Active — CNAME `staging → mango-glacier-0abee9e0f.7.azurestaticapps.net` verified |

---

## 2. Current Stellar TestNet Contracts (source of truth: `deployments/stellar-testnet.contracts.json`)

| Contract | ID | Operator | Status |
|---|---|---|---|
| `NodeZeroIdentity` | `CCHFYOKLGVTXEYYHWEFPI22FR26VRGG2CBBUTP6XPW3ZSIWIKEVQQ44K` | `GBMXG2UIWFBHPKRBDQCEFNIDR3WHJAPVVGBCIOD5SGKZYZQISENZKD5O` | ✅ Live — TestNet |
| `Lockb0x` | `CB36LY5WZLJNMY4DHRXQER6LU3L4E5MGFYT2XSJG7ZJZV5SIIOKODT2H` | (demo-init) | ✅ Live — TestNet |
| `Lockb0xFactory` (v2) | `CA5MASVC7CH646QUZM6HFC3JAYIG4TCRHJDSBDOBFP66IW7TXYYHFUVB` | Deployer `GDMJ3GFM…` | ✅ Live — wasmHash `795157cc…`; replaces v1 `CBV5KWYW…` |

Key Vault mirrors (RBAC: Key Vault Secrets Officer required to write):
- `stellar-identity-contract-id` → `CCHFYOKLGVTXEYYHWEFPI22FR26VRGG2CBBUTP6XPW3ZSIWIKEVQQ44K`
- `stellar-lockbox-contract-id` → `CB36LY5WZLJNMY4DHRXQER6LU3L4E5MGFYT2XSJG7ZJZV5SIIOKODT2H`

### Two-account funding model (TestNet)

| Role | Alias | Public key | KV secret | Purpose |
|---|---|---|---|---|
| Treasury (canonical funder) | `nodezero-testnet-treasury` | `GAUMNOPBK5WYUGIV2VH7JXMHACFSB4QV4HCJM5LB7ERUYKUN6UEZGEYI` | `stellar-treasury-secret` | Funds member account creation + fee-bumps; tops up Deployer to ≥50 XLM |
| Deployer (factory operator) | `nodezero-testnet-deployer` | `GDMJ3GFM2RPB5FRX5DS2IRRSVF6RFYILXZ2WIUIJQJJOHXJTQXOQVBHR` | `stellar-deployer-secret` | Deploys + initializes per-user lockb0x contracts and pays their gas |

Pre-flight invariant: before every lockb0x creation the provisioner ensures the Deployer holds ≥ `JSS_DEPLOYER_MIN_XLM` (default 50), topping up from the Treasury when below the floor ([deployerTopup.ts](../packages/jss-provisioner/src/deployerTopup.ts)).

---

## 3. CI/CD Artifact → Runtime Resource → App Feature Matrix

This is the correlation layer: what workflow/artifact deploys what, and what user-visible feature depends on it.

| App feature | App code entry point | CI/CD artifact | Runtime resource(s) | Smoke/UAT gate |
|---|---|---|---|---|
| Landing page, all routes | `packages/mobile-app/app/*.tsx` | SWA publish — [staging-deploy.yml#L136](../.github/workflows/staging-deploy.yml) | W1 (`…-web`) | A1, A2 smoke + UAT AU1–AU3 |
| OIDC Solid sign-in (redirect) | [SolidContext.tsx](../packages/mobile-app/src/contexts/SolidContext.tsx) | Build env: `NZ_SOLID_OIDC_ISSUER_URL` baked into Expo bundle | W1 (SWA) + external Solid IdP | UAT AU1 — **PASS 2026-06-28** |
| Seamless "Create Your Node" | [seamlessSignup.ts](../packages/mobile-app/src/onboarding/seamlessSignup.ts) → provisioner | SWA publish + `NZ_JSS_PROVISIONER_URL` env in build | W1 (SWA) → S1 (provisioner) → I1 (CSS) | QA: [solid-account-endpoint-smoke.mjs](../scripts/qa/solid-account-endpoint-smoke.mjs) — **PASS 2026-06-29** |
| Pod account creation + CSS account JSON API | [solidAccount.ts](../packages/jss-provisioner/src/solidAccount.ts) | Provisioner zip deploy — [staging-deploy.yml#L82](../.github/workflows/staging-deploy.yml#L82) | S1 (provisioner) → I1 (CSS) → I4 (storage) | Manual: `solid-pod-smoke.mjs` |
| Stellar attestation anchoring + per-user Lockb0x | [lockboxFactory.ts](../packages/jss-provisioner/src/lockboxFactory.ts) | Provisioner deploy + `JSS_LOCKBOX_FACTORY_MODE=soroban` app setting | S1 (provisioner) + Stellar TestNet RPC (external) | QA: `soroban-provision-smoke.mjs` — **PASS 2026-06-29** |
| Treasury-sponsored member account creation (P3) | [treasuryCreateAccount.ts](../packages/jss-provisioner/src/treasuryCreateAccount.ts) + `POST /v1/create-account` | Provisioner deploy + `JSS_TREASURY_FUND_MEMBERS=1` / `JSS_INTERNAL_API_KEY` app settings | S1 (provisioner) + Treasury key + Stellar TestNet | Unit: `treasuryCreateAccount.test.ts` — **PASS**; idempotent + fail-closed |
| Pod account document write (DPoP) | [solidAccount.ts#writePodAccountDocument](../packages/jss-provisioner/src/solidAccount.ts) | Provisioner deploy + `JSS_SOLID_CSS_BASE_URL` app setting | S1 (provisioner) → I1 (CSS) | Covered by E2E onboarding PASS 2026-06-29 |
| ZK Proof of Pod Ownership browser proof | [pod-ownership-prover.ts](../packages/zk-crypto/src/pod-ownership-prover.ts) | ZK artifact build → blob upload to A1 | W1 (SWA) + A1 (storage, ZK artifacts) | UAT AT1–AT3 — **PASS 2026-06-26** |
| On-chain wallet registration (`NodeZeroIdentity`) | [WalletContext.tsx](../packages/mobile-app/src/contexts/WalletContext.tsx) | SWA publish + contract IDs from K1 | W1 (SWA) + K1 (Key Vault) + Stellar TestNet | UAT AT1 — **PASS 2026-06-26** |
| Global feed (FOAF + Docustream) | [feed.tsx](../packages/mobile-app/app/feed.tsx) | SWA publish | W1 (SWA) + I1 (CSS, user pods) | UAT FE1 — **PASS 2026-06-28** |
| Profile read/write (Solid Pod) | [profile.tsx](../packages/mobile-app/app/profile.tsx) + [ProfileManager.ts](../packages/solid-pod-sync/src/ProfileManager.ts) | SWA publish | W1 (SWA) + I1 (CSS) | Manual — pending full B1/B2 |
| Social graph follow/unfollow | [compose.tsx](../packages/mobile-app/app/compose.tsx) + [SocialGraph.ts](../packages/solid-pod-sync/src/SocialGraph.ts) | SWA publish | W1 (SWA) + I1 (CSS) | Manual — pending B1/B2 |
| Docustream activity read/write | [docustream.tsx](../packages/mobile-app/app/docustream.tsx) + [DocustreamManager.ts](../packages/solid-pod-sync/src/DocustreamManager.ts) | SWA publish | W1 (SWA) + I1 (CSS) | QA L7 evidence — **PASS 2026-06-26** |
| Data Backpack ACL toggles | [backpack.tsx](../packages/mobile-app/app/backpack.tsx) + [ProfileManager.updateWebACL](../packages/solid-pod-sync/src/ProfileManager.ts) | SWA publish | W1 (SWA) + I1 (CSS) | Manual |
| Local Node P2P signaling | [p2p-comms](../packages/p2p-comms/) + relay URL in SWA bundle | SWA publish + relay service (S2/S3 — **not in staging-deploy**) | W1 (SWA) + S2 (relay) + S3 (ASP) | UAT LM1/LM2 — **PASS 2026-06-28** |
| Geospatial H3 local discovery | [DiscoveryContext + geo-discovery](../packages/geo-discovery/) | SWA publish | W1 (SWA) + geolocation API (browser) | UAT LM1 (partial — requires location grant) |
| Telemetry / diagnostics | App Insights SDK in Expo runtime | SWA publish + App Insights connection string (O1/O2) | O1 (App Insights) + O2 (Log Analytics) | UAT EO1 — **PASS**; EO2 — **NOT TESTED** |

---

## 4. Deployment Track Ownership

The staging runtime is deployed across **three separate tracks**. This is the primary source of
operational drift risk.

| Track | Trigger | What it deploys | Who owns it |
|---|---|---|---|
| **Track 1 — Baseline infra + web + provisioner** | Push to `testnet` branch or manual dispatch — [staging-deploy.yml](../.github/workflows/staging-deploy.yml) | W1, O1, O2, K1, A1, D1 (Bicep) + S1 (zip deploy) + SWA artifact | CI/CD (automated) |
| **Track 2 — Solid server stack** | Manual dispatch only — [redeploy-solid-server.yml](../.github/workflows/redeploy-solid-server.yml) | I1, I2, I3, I4, I5 (Bicep + ACA cert bind) | Manual (on-demand) |
| **Track 3 — Relay** | **Not codified in any current workflow or Bicep** | S2 (`…-relay`), S3 (`asp-nodezero-staging-relay`) | Ad hoc / manual |

> ⚠️ Track 3 is the highest operational risk. The relay is confirmed live (`/health` 200, WebSocket PASS)
> but its lifecycle is not codified — a resource group redeploy or accidental deletion has no automated
> recovery path.

---

## 5. Provisioner App Settings (runtime wiring, not in IaC)

These settings are applied via `az webapp config appsettings set` and are not tracked in Bicep or the
staging deploy workflow. They are the main source of config drift between CI/CD intent and runtime state.

| Setting | Purpose | Current value (confirmed) | Risk if missing |
|---|---|---|---|
| `JSS_SOLID_CSS_BASE_URL` | Provisioner → CSS account API base URL | `https://nz-staging-testnet-solid.calmwater-b7429d4d.eastus2.azurecontainerapps.io` | Seamless onboarding returns 503 |
| `JSS_LOCKBOX_FACTORY_CONTRACT_ID` | Factory contract for per-user lockbox | `CA5MASVC7CH646QUZM6HFC3JAYIG4TCRHJDSBDOBFP66IW7TXYYHFUVB` (v2, Deployer operator) | Soroban lockbox provision fails |
| `JSS_LOCKBOX_FACTORY_MODE` | `soroban` = live Stellar invoke, `mock` = stub | `soroban` | Attestation silently skipped or returns mock data |
| `JSS_STELLAR_SOURCE_ACCOUNT` | Legacy single-key alias (fallback for Treasury/Deployer) | `nodezero-staging-provisioner` | Soroban invocations fail at key lookup |
| `JSS_TREASURY_SOURCE_ACCOUNT` | Treasury CLI key alias — funds accounts + tops up Deployer | `nodezero-testnet-treasury` | Falls back to `JSS_STELLAR_SOURCE_ACCOUNT` |
| `JSS_DEPLOYER_SOURCE_ACCOUNT` | Deployer CLI key alias — factory operator, pays lockb0x gas | `nodezero-testnet-deployer` | Falls back to `JSS_STELLAR_SOURCE_ACCOUNT` |
| `JSS_DEPLOYER_MIN_XLM` | Deployer top-up floor (pre-flight before each lockb0x) | `50` | Defaults to 50 |
| `JSS_TREASURY_FUND_MEMBERS` | `1` = provisioner Treasury-funds member accounts during onboarding (MainNet: no Friendbot) | unset (testnet uses Friendbot) | Members not auto-funded; MainNet register_webid fails |
| `JSS_INTERNAL_API_KEY` | Enables + authenticates `POST /v1/create-account` (fail-closed when unset) | unset (endpoint disabled) | Endpoint returns 503; onboarding auto-fund still works |
| `JSS_MEMBER_STARTING_XLM` | Sponsored starting balance for new member accounts (capped by `JSS_MEMBER_STARTING_MAX_XLM`, default 2) | `1` | Defaults to 1 XLM |
| `JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS` | Operator public key for factory | Derived from source account at startup | Factory initialize fails if mismatched |
| `JSS_LOCKBOX_WASM_HASH` | Pinned wasm hash for direct lockbox deploy fallback | `795157cc49e66f79d2ce06049687d5ad20d625d38c772035dbb4e9463360885f` | Direct deploy fallback resolves dynamically (latency) |
| `JSS_STELLAR_RPC_URL` | Soroban RPC for contract invocations | `https://soroban-testnet.stellar.org` | Falls back to default (safe but unverified) |
| `JSS_STELLAR_NETWORK_PASSPHRASE` | Network passphrase guard | `Test SDF Network ; September 2015` | Falls back to hardcoded default (environment boundary risk) |
| `NZ_ENV_PROFILE` | Environment isolation tag in provisioner responses | `staging-testnet` | Health endpoint returns wrong profile |

**Verification:** Run `scripts/qa/verify-staging-drift.mjs` to compare expected vs actual values.

---

## 6. Implementation Status Tracker

Each row is a discrete unit of work. Mark ✅ when complete with evidence.

### 6.1 Infrastructure (Azure)

| ID | Item | Status | Evidence / Notes |
|---|---|---|---|
| INF-01 | Baseline Bicep stack (`main.bicep`) deployed to staging | ✅ Done | Bicep deploy confirmed, SWA online 2026-06-26 |
| INF-02 | SWA custom domain `staging.nodezero.social` bound + TLS | ✅ Done | DNS CNAME `mango-glacier-0abee9e0f.7.azurestaticapps.net`, staging-domain-cutover.json |
| INF-03 | App Insights + Log Analytics workspace active | ✅ Done | O1/O2 present in resource graph; manual portal verification pending |
| INF-04 | Key Vault holding contract IDs + ZK URLs | ✅ Done | `nodezerosocialstagingtes` — confirmed 2026-06-26 |
| INF-05 | Storage account for ZK artifacts blob | ✅ Done | `stki7yquyjmnskg`, ZK artifacts URL in provisioner and app config |
| INF-06 | Solid Bicep stack (`solid-server.bicep`) deployed | ✅ Done | ACA env + app confirmed; cert `solid-nodezero-social-cert` active |
| INF-07 | Relay App Service + plan provisioned | ✅ Done | S2/S3 confirmed live in resource graph — **not in Bicep** |
| INF-08 | **Codify relay deployment in IaC or workflow** | ⬜ To Do | Currently manual only; no recovery path exists in CI/CD |
| INF-09 | **Add provisioner app settings to staging-deploy workflow** | ⬜ To Do | All JSS_ settings currently applied ad hoc via terminal commands |
| INF-10 | Alert email wired to action group for RG admin errors | ⬜ To Do | `alertEmailAddress` is empty in `main.parameters.staging-testnet.json` |
| INF-11 | `pnpm policy:validate-env` always passes on testnet branch | ✅ Done | Confirmed in terminal exit 0 (2026-06-30) |

### 6.2 CI/CD Pipeline

| ID | Item | Status | Evidence / Notes |
|---|---|---|---|
| CICD-01 | Staging deploy workflow triggers on `testnet` branch push | ✅ Done | [staging-deploy.yml](../.github/workflows/staging-deploy.yml) |
| CICD-02 | Provisioner build + zip deploy + health gate in workflow | ✅ Done | Steps 82–114 in staging-deploy.yml |
| CICD-03 | Expo web build bakes correct staging env vars | ✅ Done | `NZ_JSS_PROVISIONER_URL` wired; other staging vars via GitHub environment |
| CICD-04 | `pnpm qa:smoke` runs as post-deploy gate | ✅ Done | Step 171+ in staging-deploy.yml; PASS confirmed 2026-06-30 |
| CICD-05 | Solid server redeploy workflow available for on-demand refresh | ✅ Done | [redeploy-solid-server.yml](../.github/workflows/redeploy-solid-server.yml) |
| CICD-06 | **Drift detection (`verify-staging-drift.mjs`) scheduled or gated** | ⬜ To Do | Script exists; not yet wired into any CI step or scheduled run |
| CICD-07 | **Provisioner app settings pushed from workflow, not ad hoc** | ⬜ To Do | Depends on INF-09 |
| CICD-08 | CI on `testnet` branch (`ci.yml` currently targets `main` only) | ⬜ To Do | `ci.yml` runs on `main`; `testnet` has no CI gate — drift risk |
| CICD-09 | **Relay lifecycle in workflow** (deploy + health gate) | ⬜ To Do | Depends on INF-08 |

### 6.3 Solid / CSS Integration

| ID | Item | Status | Evidence / Notes |
|---|---|---|---|
| SOLID-01 | CSS 7.1.9 running on ACA with persistent Azure Files data mount | ✅ Done | `nz-staging-testnet-solid`, `stsolidzfjw3yqgsg26g` |
| SOLID-02 | Custom domain `solid.nodezero.social` bound with managed cert | ✅ Done | `solid-nodezero-social-cert` active |
| SOLID-03 | Provisioner calls CSS account JSON API (create/password/pod/creds) | ✅ Done | [solidAccount.ts](../packages/jss-provisioner/src/solidAccount.ts); E2E PASS 2026-06-29 |
| SOLID-04 | Provisioner writes account document to Pod via DPoP token flow | ✅ Done | [solidAccount.ts#writePodAccountDocument](../packages/jss-provisioner/src/solidAccount.ts) |
| SOLID-05 | OIDC redirect login via `solidcommunity.net` (external IdP path) | ✅ Done | UAT AU1 PASS 2026-06-28 |
| SOLID-06 | OIDC redirect login via NodeZero self-hosted CSS (`solid.nodezero.social`) | ✅ Done | `NZ_NODEZERO_ISSUER_URL` wired; E2E validation 2026-06-29 |
| SOLID-07 | Profile R/W (`ProfileManager`) working against CSS-hosted pods | ⬜ To Do | Code implemented; no UAT evidence of full write+readback yet |
| SOLID-08 | Social graph follow/unfollow (`SocialGraph`) wired to staging pods | ⬜ To Do | Code implemented (B1/B2 in-progress) |
| SOLID-09 | **NSFW scanner annotating Pod dataset correctly** | ⬜ To Do | Unit tests pass; no staging evidence |
| SOLID-10 | **ACL toggle (`updateWebACL`) tested against CSS WAC** | ⬜ To Do | CSS WAC must be enabled; behavior may differ from solidcommunity.net |

### 6.4 Stellar / ZK Layer

| ID | Item | Status | Evidence / Notes |
|---|---|---|---|
| ZK-01 | `NodeZeroIdentity` contract live on TestNet | ✅ Done | `CCHFYOKLGVTXEYYHWEFPI22FR26VRGG2CBBUTP6XPW3ZSIWIKEVQQ44K` 2026-06-26 |
| ZK-02 | `Lockb0x` contract live on TestNet | ✅ Done | `CB36LY5WZLJNMY4DHRXQER6LU3L4E5MGFYT2XSJG7ZJZV5SIIOKODT2H` |
| ZK-03 | `Lockb0xFactory` contract live on TestNet | ✅ Done | v2 `CA5MASVC7CH646QUZM6HFC3JAYIG4TCRHJDSBDOBFP66IW7TXYYHFUVB` (Deployer operator); replaces v1 `CBV5KWYW…` |
| ZK-04 | ZK artifacts (wasm + zkey + vk) published to blob storage | ✅ Done | `stki7yquyjmnskg/zk-artifacts/`; manifest URL in app bundle |
| ZK-05 | Browser Groth16 proof generation + submission flow | ✅ Done | `pod-ownership-prover.ts`; UAT AT1/AT2/AT3 PASS 2026-06-26 |
| ZK-06 | Per-user Lockb0x deploy + initialize via provisioner | ✅ Done | Onboarding E2E PASS 2026-06-29; `storage_entries:3` confirmed on-chain. UI happy-path re-validated 2026-07-01 (lockbox `CBFEODFE…`, creator=Deployer) |
| ZK-06b | Treasury → Deployer pre-flight top-up (≥50 XLM) | ✅ Done | [deployerTopup.ts](../packages/jss-provisioner/src/deployerTopup.ts); fail-closed |
| ZK-06c | Treasury-sponsored member `CreateAccount` (P3) | ✅ Done | [treasuryCreateAccount.ts](../packages/jss-provisioner/src/treasuryCreateAccount.ts); `POST /v1/create-account` (internal-key gated) + onboarding auto-fund via `JSS_TREASURY_FUND_MEMBERS`; unit tests PASS |
| ZK-06d | True `FeeBumpTransaction` wrapping (P4) | ⚪ Deferred | Blocked by zero-dependency provisioner (no `@stellar/stellar-sdk`) + no `stellar` CLI fee-bump command. Requirement "users pay no fees / need no pre-funded account" is met by ZK-06c Treasury funding. Revisit if a dedicated SDK-backed signer service is introduced |
| ZK-07 | Returning sign-in lockbox root verification | ✅ Done | UAT AT3 PASS 2026-06-26 |
| ZK-08 | **Checksum verification (`pnpm verify:checksums:testnet`) in CI** | ⬜ To Do | Script exists; not run in current CI gate |
| ZK-09 | **Contract drift check between Key Vault and `stellar-testnet.contracts.json`** | ⬜ To Do | `verify-staging-drift.mjs` checks bundle; does not verify Key Vault directly |

### 6.5 Application Features

| ID | Item | Status | Evidence / Notes |
|---|---|---|---|
| APP-01 | Landing page renders + sign-in form | ✅ Done | UAT A1 PASS |
| APP-02 | OIDC sign-in round-trip returns authenticated session | ✅ Done | UAT AU1 PASS 2026-06-28 |
| APP-03 | Seamless Create Your Node (no redirect) | ✅ Done | E2E PASS 2026-06-29 |
| APP-04 | Wallet provisioning on web (localStorage fallback) | ✅ Done | UAT WR1 PASS |
| APP-05 | WebID registration on-chain (`register_webid`) | ✅ Done | UAT AT1 PASS 2026-06-26 |
| APP-06 | Settings page (wallet key, WebID, NSFW toggle, sign-out) | ✅ Done | UAT X2/WR1 |
| APP-07 | Feed renders chronologically from FOAF graph | ⬜ To Do | Shell renders; no real Pod connections yet — B1 |
| APP-08 | Local Node — location grant + H3 index + relay discovery | ✅ Done (partial) | UAT LM1 PASS with geolocation mock; normal browser requires location allow |
| APP-09 | Local Node — two-client message exchange E2E | ✅ Done | UAT LM2 PASS 2026-06-28 (QA identities) |
| APP-10 | Profile write+read against real staging pod | ⬜ To Do | Pending B1/B2 |
| APP-11 | Docustream list+save against real staging pod | ✅ Done | QA L7 evidence PASS |
| APP-12 | Backpack ACL toggle against CSS WAC | ⬜ To Do | Depends on SOLID-10 |
| APP-13 | **Auth chip label accurate for node sessions** (currently hardcoded `OIDC Redirect`) | ⬜ To Do | Feed shows wrong label for seamless-node sessions |
| APP-14 | **Semantic overlap (`findSemanticOverlap`) against staging pods** | ⬜ To Do | Code in profile.tsx; requires pods with real interests data |

---

## 7. Open Gaps and Risk Register

| ID | Gap | Severity | Action needed |
|---|---|---|---|
| G1 | Relay not codified in IaC or workflow — no recovery path | **High** | Create `relay-service.bicep` or extend `staging-deploy.yml` to include relay App Service provision + deploy + health gate (INF-08, CICD-09) |
| G2 | Provisioner JSS_ app settings applied ad hoc — drift risk on every redeploy | **High** | Add `az webapp config appsettings set` step with all required settings to `staging-deploy.yml` after provisioner zip deploy (INF-09, CICD-07) |
| G3 | CI (`ci.yml`) does not run on `testnet` branch — no automated gate before staging-deploy | **Medium** | Add `testnet` to `on.push.branches` in `ci.yml`, or create a separate pre-deploy validation job in `staging-deploy.yml` (CICD-08) |
| G4 | `verify-staging-drift.mjs` not scheduled or wired into pipeline | **Medium** | Add as a post-deploy step or scheduled workflow run (CICD-06) |
| G5 | Alert email not wired — no automated incident notification | **Medium** | Set `alertEmailAddress` in `main.parameters.staging-testnet.json` (INF-10) |
| G6 | Auth mode chip in Feed/Local hardcoded to `OIDC Redirect` — misleading for node sessions | **Low** | Use `nodeSession !== null` to conditionally set chip label (APP-13) |
| G7 | B1/B2 (real feed/social graph from Solid) still placeholder | **Low (current milestone)** | Post-hackathon scope; document as known gap |
| G8 | ZK artifact checksum verification not in CI | **Low** | Wire `pnpm verify:checksums:testnet` into CI gate (ZK-08) |

---

## 8. Production Migration Delta (staging-testnet → production-mainnet)

This section tracks what must change when promoting to `app.nodezero.social` on Stellar MainNet.
Items marked ⬜ are not yet started; ✅ items are already structured to support production.

### 8.1 Environment and domain

| Item | Staging | Production | Action |
|---|---|---|---|
| App URL | `staging.nodezero.social` | `app.nodezero.social` | Add DNS record + SWA custom domain binding in new production RG |
| Solid server URL | `solid.nodezero.social` | `solid.nodezero.social` or new subdomain | Decision needed — shared CSS instance or dedicated |
| Stellar network | TestNet | MainNet | Passphrase + RPC URL change; **must** never cross-wire |
| Resource group | `rg-nodezero-social-staging-testnet` | `rg-nodezero-social-production-mainnet` | Completely separate group; no shared resources |

### 8.2 CI/CD guardrails required before first production deploy

| # | Guardrail | Status |
|---|---|---|
| P1 | Separate production GitHub environment with manual approval gate | ⬜ |
| P2 | Separate OIDC federated credential / service principal for production | ⬜ |
| P3 | `scripts/azure/deploy.sh` already refuses `production-mainnet` — keep this | ✅ |
| P4 | Dedicated production deploy workflow (`production-deploy.yml`) that can only be triggered manually or on `main` branch | ⬜ |
| P5 | Production Bicep parameters file with MainNet contract IDs (separate file, never committed with secrets) | ⬜ |
| P6 | Contract ID promotion path: TestNet deploy → checksum → Key Vault staging → manual promotion audit → Key Vault production | ⬜ |
| P7 | `NZ_SEAMLESS_ONBOARDING_ENABLED=true` requires production CSS base URL in provisioner app settings | ⬜ |
| P8 | ZK artifact promotion: testnet artifacts → re-verified checksums → production blob with immutable URL | ⬜ |
| P9 | DNS CNAME for `app.nodezero.social` managed by Bicep or separate DNS workflow | ⬜ |
| P10 | Relay for production needs its own App Service plan (or ACA) in production RG | ⬜ |

### 8.3 Environment variable changes for production build

| Variable | Staging value | Production value |
|---|---|---|
| `NZ_ENV_PROFILE` | `staging-testnet` | `production-mainnet` |
| `NZ_STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | `https://soroban.stellar.org` |
| `NZ_STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| `NZ_IDENTITY_CONTRACT_ID` | TestNet ID | MainNet ID (to be deployed) |
| `NZ_LOCKBOX_CONTRACT_ID` | TestNet ID | MainNet ID |
| `NZ_LOCKBOX_FACTORY_CONTRACT_ID` | TestNet ID | MainNet ID |
| `NZ_SOLID_OIDC_ISSUER_URL` | `https://solidcommunity.net/` | `https://solid.nodezero.social/` or external |
| `NZ_RELAY_URL` | `wss://nodezero-social-staging-testnet-relay.azurewebsites.net` | production relay endpoint |
| `NZ_JSS_PROVISIONER_URL` | `https://nodezero-social-staging-testnet-provisioner.azurewebsites.net` | production provisioner endpoint |

---

## 9. How to Use This Document

1. **After each CI/CD run or manual deployment**: Update the relevant Status column to ✅/⬜/🔄 with a date note.
2. **After each QA session**: Update UAT evidence links in the feature matrix (Section 3).
3. **When opening new work items**: Add a row to Section 6 and reference this doc's ID in the commit/PR.
4. **Before production migration**: Work through all Section 8.2 guardrails; no P1–P10 item may remain ⬜ before first `production-mainnet` deploy.
5. **Config drift**: Run `node scripts/qa/verify-staging-drift.mjs` and add output as evidence when updating Section 5.

---

## 10. Quick Reference: Useful Commands

```bash
# Validate environment isolation policy
corepack pnpm policy:validate-env

# Run automated staging smoke gate
STAGING_BASE_URL=https://staging.nodezero.social bash scripts/qa/staging-smoke.sh

# Check provisioner/bundle config drift
STAGING_BASE_URL=https://staging.nodezero.social \
NZ_JSS_PROVISIONER_URL=https://nodezero-social-staging-testnet-provisioner.azurewebsites.net \
node scripts/qa/verify-staging-drift.mjs

# Solid account creation smoke (requires JSS_PROVISIONER_URL)
JSS_PROVISIONER_URL=https://nodezero-social-staging-testnet-provisioner.azurewebsites.net \
node scripts/qa/solid-account-endpoint-smoke.mjs

# Relay WebSocket E2E smoke
node scripts/qa/relay-signal-e2e.mjs

# Soroban provision smoke
JSS_PROVISIONER_URL=https://nodezero-social-staging-testnet-provisioner.azurewebsites.net \
NZ_LOCKBOX_FACTORY_CONTRACT_ID=CBV5KWYWK4O44JX4JK57IDGPA2IZSKJR2SC2UNYV65RU4S7MSK66F2WA \
node scripts/qa/soroban-provision-smoke.mjs

# Download provisioner runtime logs
az webapp log download \
  --resource-group rg-nodezero-social-staging-testnet \
  --name nodezero-social-staging-testnet-provisioner \
  --log-file provisioner-logs-latest.zip

# View current provisioner app settings
az webapp config appsettings list \
  --resource-group rg-nodezero-social-staging-testnet \
  --name nodezero-social-staging-testnet-provisioner \
  --query "[].{name:name,value:value}" -o table
```

---

*Related documents:*
- [Environment isolation matrix](environment-isolation-matrix.md)
- [Staging UAT checklist](staging-uat-checklist.md)
- [Staging deployment blueprint](staging-deployment-blueprint.md)
- [TestNet Azure release requirements](testnet-azure-release-requirements.md)
- [Milestone G release evidence summary](milestone-g-release-evidence-summary.md)
