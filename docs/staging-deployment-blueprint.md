# NodeZero Staging Deployment Blueprint

Date: 2026-06-24
Target URL: staging.nedzero.social
Network: Stellar TestNet
Cloud: Azure

## 1. System purpose and value path

NodeZero is a decentralized social platform where:
- Identity and chain attestations are handled through Soroban contracts on Stellar TestNet.
- User data and social graph live in user-controlled Solid Pods.
- Geo-local discovery uses H3 abstraction instead of sharing raw GPS.
- UX is delivered through Expo Router (web/mobile).

The staging goal is to validate that these layers interoperate in a production-like Azure environment under real network conditions.

## 2. Architecture map (as implemented now)

Client and shared packages:
- packages/mobile-app: primary UI and orchestration context providers.
- packages/embedded-wallet: secure key generation/storage and Soroban invocation wrapper.
- packages/geo-discovery: H3 indexing and local-neighborhood computations.
- packages/p2p-comms: WebRTC channel + signaling client abstraction.
- packages/solid-pod-sync: Solid profile and social graph read/write layer.
- packages/zk-crypto: circom circuits and build output for manifest generation.

Chain and cryptography:
- packages/contracts: Rust Soroban contracts for identity and Lockb0x root state.
- scripts/stellar/deploy-testnet.sh: build + deploy flow that emits deployment manifest.
- scripts/zk/prepare-testnet.sh and prepare-artifacts.mjs: circuit build + artifact digest manifest.

Cloud platform:
- infrastructure/azure/main.bicep provisions Log Analytics, App Insights, Storage, Key Vault, and Static Web App.
- scripts/azure/deploy.sh performs group deployment from Bicep.

## 3. Staging infrastructure requirements

### Azure subscription and governance
- One dedicated non-production subscription or resource group boundary for staging.
- RBAC model:
  - IaC deploy identity with Contributor on target resource group.
  - Least privilege for app/runtime identities.
- Cost governance:
  - Budget + alert threshold.
  - Retention and ingestion controls for telemetry.

### Networking and domain
- DNS zone control for nedzero.social.
- CNAME for staging.nedzero.social to SWA default hostname.
- TLS certificate validation completed in SWA custom domain settings.

### Secret and configuration management
- Key Vault must hold at minimum:
  - Stellar identity contract id.
  - Stellar lockbox contract id.
  - ZK artifacts URL.
  - ZK manifest URL.
- App configuration must set:
  - NZ_STELLAR_RPC_URL
  - NZ_STELLAR_NETWORK_PASSPHRASE
  - NZ_IDENTITY_CONTRACT_ID
  - NZ_LOCKBOX_CONTRACT_ID
  - NZ_ZK_ARTIFACTS_URL
  - NZ_ZK_MANIFEST_URL
  - NZ_RELAY_URL

### Observability
- App Insights configured and connected to Log Analytics workspace.
- Baseline queries and alert rules for:
  - Availability failures.
  - Front-end error rate spikes.
  - Deployment regression windows.

## 4. Readiness scoreboard

Current maturity estimates:
- Build tooling and monorepo structure: 60%
- Smart contract deployment scripting: 70%
- ZK artifact pipeline: 75%
- App functional completeness: 40%
- P2P runtime operability in staging: 20%
- Azure IaC baseline provisioning: 65%
- CI/CD release governance: 25%
- Staging domain readiness: 20%

Overall release readiness for staging: 43% (not launchable yet).

## 5. Blocking gaps and acceptance criteria

G1: Feed implementation is placeholder
- Required outcome: feed renders aggregated posts from followed WebIDs in chronological order.
- Acceptance: test account with >=3 follows shows merged and sorted feed from Solid Pod sources.

G2: Local node messaging is optimistic local state only
- Required outcome: messages flow between two clients through real relay and WebRTC path.
- Acceptance: two-device test can exchange messages and recover after reconnect.

G3: Relay backend missing
- Required outcome: deployable relay service with secure WebSocket endpoint and protocol compatibility.
- Acceptance: relay smoke script verifies offer/answer/ice routing and error handling.

G4: Solid profile interests parsing is lossy
- Required outcome: profile reader returns complete interests array.
- Acceptance: write multi-interest profile, readback exact list order-insensitive.

G5: Build/test governance inconsistent
- Required outcome: all packages either define test script or workspace runner tolerates missing tests.
- Acceptance: CI pipeline completes build/lint/type-check/test contracts with deterministic results.

G6: Azure staging hardening incomplete
- Required outcome: custom domain and TLS configured with publish workflow and rollback steps.
- Acceptance: successful blue/green or atomic publish to staging.nedzero.social with smoke pass.

G7: Contract/toolchain compatibility risk
- Required outcome: explicit protocol and SDK compatibility matrix documented and validated.
- Acceptance: deploy script, contract build, and testnet invocation validated on pinned versions.

## 6. End-to-end staged roadmap

### Stage A: Foundation hardening (Day 1-2)
Deliverables:
- Normalize package manifests and workspace scripts.
- Add CI workflows for lint/type-check/test/build/contracts.
- Add version matrix doc for Node, pnpm, Rust, Stellar CLI, Soroban SDK.
Gate:
- Main branch CI green for two consecutive runs.

### Stage B: Product completion (Day 3-6)
Deliverables:
- Real feed aggregation from Solid graph and post containers.
- Real local chat wiring via P2P channel and signaling relay.
- Platform-safe Solid auth behavior across web/native.
Gate:
- Functional smoke tests pass on web and one native target.

### Stage C: Chain and ZK operational reliability (Day 5-7)
Deliverables:
- Contract deployment script idempotency and explicit initialization checks.
- Artifact publication and checksum verification workflow.
- Signed deployment manifest and rollback recipe.
Gate:
- Repeat deployment dry-runs produce deterministic manifests.

### Stage D: Azure staging bring-up (Day 7-9)
Deliverables:
- Bicep deployment validated with what-if.
- SWA publish pipeline from Expo web build output.
- Key Vault and telemetry configuration in place.
- Custom domain + TLS active for staging.nedzero.social.
Gate:
- Public staging URL reachable with healthy telemetry and alerts.

### Stage E: Launch readiness and sign-off (Day 10-11)
Deliverables:
- End-to-end UAT and release checklist complete.
- Incident response and rollback runbook final.
- PM sign-off with artifact bundle and evidentiary links.
Gate:
- QA_RELEASE_AGENT marks release GO in shared inbox.

## 7. Deployment command sequence (target shape)

1) Prepare ZK assets
- pnpm prepare:zk:testnet

2) Deploy contracts to Stellar TestNet
- STELLAR_SOURCE_ACCOUNT=<alias> pnpm deploy:stellar:testnet

3) Publish ZK artifacts to Azure Storage and capture immutable URLs

4) Inject contract IDs and artifact URLs into secure Bicep parameters

5) Validate infra changes
- az deployment group what-if --resource-group <rg> --template-file infrastructure/azure/main.bicep --parameters @<secure-params>

6) Deploy infra
- AZURE_RESOURCE_GROUP=<rg> AZURE_BICEP_PARAMETERS_FILE=<secure-params> pnpm deploy:azure

7) Build and publish Expo web artifact to SWA

8) Bind and verify staging.nedzero.social domain + TLS

9) Run smoke suite and publish release decision

## 8. Risk register (top 10)

R1: Solid auth behavior differs between web/native.
R2: Relay service abuse or connection churn without rate limits.
R3: Soroban protocol/version drift breaks deploy path.
R4: Missing CI gates permits regression into staging.
R5: Manual variable injection errors for contract IDs.
R6: DNS/TLS propagation delays impact launch window.
R7: Missing rollback mechanism for faulty front-end releases.
R8: ZK artifact hosting integrity not enforced.
R9: Key Vault access model not fully least-privileged.
R10: Incomplete telemetry obscures incident diagnosis.

## 9. Definition of Ready and Definition of Done

Definition of Ready for staging task:
- Scope and acceptance criteria defined.
- Owner assigned.
- Dependencies and environment requirements identified.

Definition of Done for staging task:
- Implementation merged.
- Verification evidence posted in shared inbox.
- PM todo status updated.
- No unresolved P0/P1 blocker for dependent tasks.
