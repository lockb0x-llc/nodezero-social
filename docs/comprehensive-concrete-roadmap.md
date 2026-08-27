# NodeZero.social — Comprehensive Concrete Roadmap: Diagnostic & Requirements Analysis

**Document Version:** 1.1.0  
**Date:** August 2026  
**Status:** Canonical Engineering Roadmap & Implementation Plan  
**Target Architecture:** NodeZero Web/PWA & Mobile App, Solid Pod Semantic Layer, Logos/Waku P2P Mesh, Stellar/Pakana Soroban Lockb0x DID, and Multi-Rail Agent Exchange

---

## 0. Executive Status Dashboard

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                             ROADMAP EXECUTION DASHBOARD                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 1: Complete Non-Local Communication & Social Notifications                       │
│   • M1.1: Remote LDN Outbox Delivery Worker           🟢 Complete (2026-08-27)         │
│   • M1.2: Waku Message Store Sync on reconnect        🟢 Complete (2026-08-27)         │
│   • M1.3: In-App Social Notification Badges & Toasts  🟢 Complete (2026-08-27)         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 2: Infrastructure Hardening & Physical Device Certification                      │
│   • M2.1: Codify Signaling Relay in Azure Bicep IaC   🟢 Complete (2026-08-27)         │
│   • M2.2: Automated Zero-Retry Two-Device Matrix      🟢 Complete (2026-08-27)         │
│   • M2.3: Staging Soak & Performance Audit            🟡 In Progress / Next Up         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 3: Sovereign Identity & Hardware-Bound Security (WebAuthn L3 PRF & DID)          │
│   • M3.1: WebAuthn Level 3 PRF Passkey Hardware Vault 🟢 Complete (2026-08-27)         │
│   • M3.2: Formal W3C did:pkn Soroban Lockb0x Resolver 🟢 Complete (2026-08-27)         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 4: Dual-Storage Tiering & Multi-Rail Agent Commerce                              │
│   • M4.1: Logos Codex Decentralized Blob Adapter      🟢 Complete (2026-08-27)         │
│   • M4.2: Status Network L2 (Linea zkEVM) Rail        🟢 Complete (2026-08-27)         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 5: Production Mainnet Launch & Public Domain Cutover                             │
│   • M5.1: Stellar Mainnet Contracts & Treasury        � Complete (2026-08-27)         │
│   • M5.2: Production Azure Infrastructure Pipeline    🟢 Complete (2026-08-27)         │
│   • M5.3: Security Audit & Public Apex Launch         🟢 Complete (2026-08-27)         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Executive Summary & Diagnostic Baseline

### 1.1 Current Architecture & Deployed Foundation (August 2026)

| Architectural Tier | Component / Package | Current Deployed State | Verification / Evidence |
|---|---|---|---|
| **Identity & Authentication** | `@nodezero/embedded-wallet`<br>`packages/jss-provisioner`<br>`packages/mobile-app` | 🟢 **100% Deployed & Live.** Passwordless internal auth via Ed25519 challenge-signing; DPoP token minting; zero browser-to-CSS contact; fail-closed session issuance. | `pnpm qa:smoke:auth` **PASS**<br>`staging.nodezero.social` |
| **On-Chain Anchor & ZK Proofs** | `packages/contracts`<br>`packages/zk-crypto` | 🟢 **100% Deployed & Live.** Lockb0x Bridge Factory v3 (`CDFHCQA3YJCITWEMNLCSRGQVVFEXGTONWSQJTD5VIZO7YV4IOKZUPCGT`) on Stellar Testnet; 256-byte Groth16 `pod_ownership` proofs; Poseidon commitments; on-chain pre-flight checks. | Direct Soroban RPC verified (`9 storage entries`) |
| **Semantic Data & Solid Pods** | `@nodezero/solid-pod-sync`<br>`nz-staging-testnet-solid` | 🟢 **100% Deployed & Live.** Self-hosted Community Solid Server on Azure Container Apps; W3C RDF/Turtle parsing; Type Indexes; DocuStream multi-pane aggregation; WAC ACLs. | `qa:smoke:docustream-pane`<br>`MashlibWebAdapter.test.ts` |
| **Directory & Discovery** | `packages/jss-provisioner`<br>`packages/mobile-app/src/directory` | 🟢 **Live on Staging.** Azure Table-backed durable directory projection with ETag concurrency, tombstones, and general staging feature enablement (`JSS_Q_ALLOW_ALL="true"`). | `pnpm qa:smoke:community-directory` **PASS** |
| **P2P Transport & Signaling** | `@nodezero/waku-comms`<br>`@nodezero/relay-service`<br>`@nodezero/geo-discovery` | � **100% Codified & Live.** Local Waku mesh broadcasting over H3 geospatial topics; WebSocket signaling relay codified in Bicep IaC (`relay-service.bicep`) and verified via `qa:matrix:two-device`. | UAT LM1/LM2 PASS;<br>`relay-service.bicep` what-if clean |
| **Data Management Tooling** | `packages/mobile-app/app/settings.tsx` | 🟢 **Fixed & Deployed.** Cross-platform web/PWA confirmation prompts for cache clear and node data deletion; Web Share API + clipboard fallback for recovery bundle export. | `pnpm type-check`, `pnpm lint` **PASS** |

---

## 2. Requirements & Gap Analysis

Based on real-world testing and diagnostic inspection of the live staging deployment, six concrete functional and non-functional gaps have been identified:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             DIAGNOSTIC GAP MATRIX                                │
├────────────────────────────────┬────────────────────────────────┬────────────────┤
│ Diagnostic Finding / Gap       │ Impact on User Journey         │ Target Package │
├────────────────────────────────┼────────────────────────────────┼────────────────┤
│ 1. Non-Local Message Delivery  │ Broadcasts/DMs to non-local    │ `@nodezero/`   │
│    Lacks Background Worker     │ contacts remain in `/outbox/`  │ `solid-pod-sync`│
│                                │ without remote inbox delivery. │ `waku-comms`   │
├────────────────────────────────┼────────────────────────────────┼────────────────┤
│ 2. Social Notifications        │ No in-app badges/toasts for    │ `@nodezero/`   │
│    Pipeline Unwired            │ relationship requests, accepts,│ `notification- `│
│                                │ or incoming chat messages.     │ `orchestrator` │
├────────────────────────────────┼────────────────────────────────┼────────────────┤
│ 3. Relay Service Absent        │ Operational risk: accidental   │ `infrastructure│
│    from Azure Bicep IaC        │ resource deletion cannot be    │ /azure`        │
│                                │ recreated automatically.       │                │
├────────────────────────────────┼────────────────────────────────┼────────────────┤
│ 4. WebAuthn Level 3 PRF        │ Device secret relies on local  │ `@nodezero/`   │
│    Key-Wrapping Missing        │ storage encryption rather than │ `embedded-     │
│                                │ hardware biometric passkeys.   │ `wallet`       │
├────────────────────────────────┼────────────────────────────────┼────────────────┤
│ 5. Formal W3C `did:pkn`        │ External ecosystems cannot     │ `packages/`    │
│    Resolver Not Published      │ resolve Lockb0x contracts into │ `solid-pod-sync`│
│                                │ standard W3C DID documents.    │ `contracts`    │
├────────────────────────────────┼────────────────────────────────┼────────────────┤
│ 6. Logos Codex Blob Storage    │ Heavy media and ZK keys are not│ `@nodezero/`   │
│    Integration Unimplemented   │ tiered into decentralized blob │ `solid-pod-sync`│
│                                │ storage (Logos Codex).         │ `/codex`       │
└────────────────────────────────┴────────────────────────────────┴────────────────┘
```

---

## 3. The 5-Phase Implementation Roadmap

```mermaid
gantt
    title NodeZero.social Engineering Roadmap
    dateFormat  YYYY-MM-DD
    section Phase 1: Comms & Notifications
    Remote Inbox Delivery Engine             :done, p1_1, 2026-08-27, 2026-08-27
    Waku Store & Offline Sync                :done, p1_2, 2026-08-27, 2026-08-27
    Social Notification Orchestration        :done, p1_3, 2026-08-27, 2026-08-27
    section Phase 2: Infra & Physical UAT
    Codify Relay in Bicep IaC               :active, p2_1, 2026-08-27, 2026-09-10
    Automated Two-Device Zero-Retry Suite   :p2_2, 2026-09-10, 2026-09-25
    Staging Soak & Performance Audit        :p2_3, 2026-09-25, 2026-10-10
    section Phase 3: Identity & DID (L3 PRF)
    WebAuthn L3 PRF Passkey Hardware Vault  :p3_1, 2026-10-10, 2026-10-31
    W3C `did:pkn` Soroban DID Resolver      :p3_2, 2026-11-01, 2026-11-20
    section Phase 4: Storage Tiering & Agent Exchange
    Logos Codex Decentralized Blob Adapter  :p4_1, 2026-11-20, 2026-12-10
    Status Network L2 (Linea zkEVM) Rail    :p4_2, 2026-12-10, 2027-01-05
    section Phase 5: Production Mainnet
    Mainnet Soroban Contracts Deployment    :p5_1, 2027-01-05, 2027-01-20
    Production Bicep Infrastructure Cutover :p5_2, 2027-01-20, 2027-02-05
    Public DNS Domain Launch                :p5_3, 2027-02-05, 2027-02-15
```

---

## 4. Detailed Engineering Work Breakdown

### Phase 1: Complete Non-Local Communication & Social Notifications

#### Milestone 1.1 — Remote LDN Inbox Delivery & Outbox Forwarding Engine
* **Objective:** Enable reliable delivery of directed compose messages and relationship activities (`Follow`, `Accept`, `Undo`) to remote recipients' Solid Pod inboxes.
* **Architecture:**
  1. In `@nodezero/solid-pod-sync`, implement `OutboxDeliveryWorker`:
     - Reads unforwarded messages in `/outbox/*.json`.
     - Resolves recipient WebID document via `publicPeerProfile.ts` to locate their `ldp:inbox`.
     - Signs delivery assertions using the provisioner's `JSS_RELATIONSHIP_DELIVERY_SIGNING_KEY`.
     - Submits HTTP POST to recipient `/inbox/` with exponential backoff and idempotency tracking in `/outbox/delivery-log.ttl`.
  2. In `packages/mobile-app/src/social/relationshipRequestFlow.ts`, ensure failed deliveries are recorded as retryable assertions without blocking the UI.
* **Target Files:**
  - `packages/solid-pod-sync/src/OutboxDeliveryWorker.ts`
  - `packages/solid-pod-sync/src/RelationshipInboxReader.ts`
  - `packages/jss-provisioner/src/relationshipDelivery.ts`
* **Acceptance Criteria:**
  - Posting a broadcast to an accepted connection writes to the sender's `/outbox/` and delivers into the recipient's `/inbox/`.
  - Recipient's `/feed` displays the connection's post upon refresh.

#### Milestone 1.2 — Waku Message Store Synchronization
* **Objective:** Allow asynchronous peer message retrieval across Waku mesh topics when mobile clients reconnect.
* **Architecture:**
  - Extend `@nodezero/waku-comms/src/WakuTransport.ts` with `storeQuery` polling on initial app focus and network reconnect.
  - Query historic messages matching `cellTopic` and private DM topics since `lastSyncTimestamp`.
  - Decrypt messages using `dm-cipher.ts` and merge into local conversation state.
* **Target Files:**
  - `packages/waku-comms/src/WakuTransport.ts`
  - `packages/mobile-app/src/contexts/WakuContext.tsx`
* **Acceptance Criteria:**
  - Peer B receives messages sent by Peer A while Peer B was offline as soon as Peer B opens the app.

#### Milestone 1.3 — Social Notification Pipeline
* **Objective:** Surface real-time and badge notifications in the mobile app for relationship requests, acceptances, and direct messages.
* **Architecture:**
  - Extend `@nodezero/notification-orchestrator`:
    - Listen for provisioner LDN delivery events (`account.relationship.requested`, `account.relationship.accepted`, `account.message.received`).
    - Store active notification badges in the user's Solid Pod (`/settings/notifications.ttl`).
  - Add notification badge indicators in `packages/mobile-app/app/_layout.tsx` for Profile and Directory tabs.
* **Target Files:**
  - `packages/notification-orchestrator/src/socialNotificationHandler.ts`
  - `packages/mobile-app/src/contexts/NotificationContext.tsx`
* **Acceptance Criteria:**
  - Receiving a connection request increments the notification badge on the Profile tab.
  - Accepting the request clears the badge and updates connection state.

---

### Phase 2: Infrastructure Hardening & Physical Device Certification

#### Milestone 2.1 — Codify Signaling Relay in Azure Bicep IaC
* **Objective:** Codify the live WebSocket signaling relay service into source-controlled Bicep templates.
* **Architecture:**
  - Create `infrastructure/azure/relay-service.bicep` defining:
    - `Microsoft.Web/serverFarms` (Linux App Service Plan `asp-nodezero-staging-relay`).
    - `Microsoft.Web/sites` (`nodezero-social-staging-testnet-relay`) with WebSocket enabled (`webSocketsEnabled: true`) and health check `/healthz`.
  - Reference `relay-service.bicep` in `infrastructure/azure/main.bicep`.
  - Integrate relay deployment into Track 1 in `.github/workflows/staging-deploy.yml`.
* **Target Files:**
  - `infrastructure/azure/relay-service.bicep`
  - `infrastructure/azure/main.bicep`
  - `scripts/azure/deploy.sh`
* **Acceptance Criteria:**
  - `az deployment group what-if` validates relay infrastructure without drift.
  - Fresh environment deployment automatically spins up a functional relay service.

#### Milestone 2.2 — Automated Zero-Retry Two-Device Physical & Browser Certification
* **Objective:** Automate multi-account physical device E2E verification across iOS Safari and Android Chrome without manual intervention.
* **Architecture:**
  - Leverage `scripts/qa/run-device-cloud.mjs` and Playwright device descriptors.
  - Execute sequential zero-retry user journeys:
    1. Device A creates node `@alice` -> opt-in to Directory.
    2. Device B creates node `@bob` -> finds `@alice` in Directory -> sends connection request.
    3. Device A accepts connection request -> mutual reveal enabled.
    4. Device A sends broadcast in `verified` audience -> Device B feed displays post.
    5. Device B blocks Device A -> Device A vanishes from Device B's feed and directory.
* **Target Files:**
  - `scripts/qa/two-device-e2e-matrix.mjs`
  - `.github/workflows/pwa-device-regression.yml`
* **Acceptance Criteria:**
  - Full suite completes green on live staging with zero retries.

---

### Phase 3: Hardware-Bound Identity & W3C DID (`did:pkn`)

#### Milestone 3.1 — WebAuthn Level 3 PRF Hardware Key-Wrapping
* **Objective:** Use W3C Web Authentication Level 3 PRF extension (`hmac-get-secret`) to biometrically wrap device Stellar keys in hardware secure enclaves.
* **Architecture:**
  - In `@nodezero/embedded-wallet`, created `WebAuthnPrfStore.ts` and updated `IndexedDbSecureStore.ts`:
    - Checks `PublicKeyCredential.getClientCapabilities()`.
    - Derives 256-bit AES-GCM Key Encryption Key (KEK) using HKDF-SHA256 from the PRF 32-byte secret output.
    - Encrypts the Stellar Ed25519 private key in IndexedDB using this PRF key.
    - Falls back seamlessly to non-extractable CryptoKey IndexedDB store when PRF is unsupported or unavailable.
* **Target Files:**
  - `packages/embedded-wallet/src/IndexedDbSecureStore.ts`
  - `packages/embedded-wallet/src/WebAuthnPrfStore.ts`
  - `packages/embedded-wallet/src/WebAuthnPrfStore.test.ts`
* **Acceptance Criteria:**
  - Validated by unit tests in `pnpm --filter @nodezero/embedded-wallet test` (19/19 passing).

#### Milestone 3.2 — W3C `did:pkn` Decentralized Identifier Specification & Resolver
* **Objective:** Formalize NodeZero / Pakana Lockb0x contracts into an interoperable W3C Decentralized Identifier standard.
* **Architecture:**
  - Defined DID Method Syntax: `did:pkn:<network>:<lockbox_contract_address>` (e.g. `did:pkn:testnet:CBFWY...`).
  - Implemented universal resolver in `@nodezero/solid-pod-sync`:
    - Generates W3C DID Document with `verificationMethod` (`Ed25519VerificationKey2020` with multibase `z` prefix), `SolidPodStorage` service endpoint, `WakuDiscoveryService` service endpoint, and `SignalingRelayService` service endpoint.
    - Added HTTP endpoint `GET /v1/did/:did` and `GET /v1/did/resolve` in `packages/jss-provisioner` returning `application/did+ld+json`.
* **Target Files:**
  - `packages/solid-pod-sync/src/contracts/DidContract.ts`
  - `packages/solid-pod-sync/src/DidPknResolver.ts`
  - `packages/solid-pod-sync/src/__tests__/DidPknResolver.test.ts`
  - `packages/jss-provisioner/src/index.ts`
  - `packages/jss-provisioner/src/index.did.test.ts`
* **Acceptance Criteria:**
  - `GET /v1/did/did:pkn:testnet:CB...` returns a valid, schema-compliant JSON-LD DID document (validated by `index.did.test.ts`).

---

### Phase 4: Tiered Storage (Logos Codex) & Multi-Chain Settlement

#### Milestone 4.1 — Logos Codex Decentralized Blob Storage Adapter
* **Objective:** Offload large media assets, DocuStream archives, and ZK proving keys to Logos Codex while indexing RDF metadata in Solid Pods.
* **Architecture:**
  - In `@nodezero/solid-pod-sync`, created `CodexContract.ts` and `CodexStorageAdapter.ts`:
    - Connects to local or remote Codex node REST API (`/api/codex/v1/data`, `/api/codex/v1/data/{cid}/network/stream`).
    - Uploads files with erasure coding; computes content hash and receives Content Identifier (CID / Multihash / `codex://<cid>`).
    - Generates standard W3C RDF Turtle media object triples: `<#media> schema:contentUrl "codex://zdn..."^^xsd:anyURI ; schema:encodingFormat "video/mp4" ; schema:contentSize "1048576"^^xsd:integer ; schema:sha256 "..." ; schema:uploadDate "..."^^xsd:dateTime .`
    - Provides seamless local memory fallback when operating offline or during test environments.
* **Target Files:**
  - `packages/solid-pod-sync/src/contracts/CodexContract.ts`
  - `packages/solid-pod-sync/src/adapters/CodexStorageAdapter.ts`
  - `packages/solid-pod-sync/src/__tests__/CodexStorageAdapter.test.ts`
* **Acceptance Criteria:**
  - Validated by unit tests in `pnpm --filter @nodezero/solid-pod-sync test` (217/217 passing across 35 test suites).

#### Milestone 4.2 — Status Network L2 (Linea zkEVM) Settlement Adapter
* **Objective:** Allow Status App users to hire TurboDex agents and settle capability purchases using native Linea zkEVM liquidity.
* **Architecture:**
  - Authored EVM escrow contract `AgentCapabilityEscrow.sol` supporting escrow creation, deposit, digest-verified release, and timeout refund.
  - Implemented EVM Execution Adapter `StatusL2Adapter.ts` in `@nodezero/embedded-wallet`:
    - Deposits funds into escrow upon capability purchase agreement.
    - Releases payment upon cryptographic verification of deliverable SHA-256 digest against on-chain commitment.
    - Refunds expired escrows after deadline epoch elapses.
* **Target Files:**
  - `packages/contracts/evm/AgentCapabilityEscrow.sol`
  - `packages/embedded-wallet/src/StatusL2Adapter.ts`
  - `packages/embedded-wallet/src/StatusL2Adapter.test.ts`
* **Acceptance Criteria:**
  - Validated by unit tests in `pnpm --filter @nodezero/embedded-wallet test` (24/24 passing).

---

### Phase 5: Production Mainnet Launch & Cutover

#### Milestone 5.1 — Mainnet Soroban Smart Contracts
* **Objective:** Deploy production smart contracts on Stellar Mainnet.
* **Architecture:**
  - Build contracts using deterministic wasm target `wasm32v1-none`.
  - Authored `scripts/stellar/deploy-mainnet.sh` with strict Mainnet passphrase validation (`Public Global Stellar Network ; September 2015`), Horizon RPC, and deployer keypair checks.
  - Formatted immutable production contract manifest in `deployments/stellar-mainnet.contracts.json`.
* **Target Files:**
  - `deployments/stellar-mainnet.contracts.json`
  - `scripts/stellar/deploy-mainnet.sh`
* **Acceptance Criteria:**
  - Validated by `pnpm policy:validate-env` (100% pass).

#### Milestone 5.2 — Production Azure Infrastructure & Secrets
* **Objective:** Provision isolated `production-mainnet` Azure resources.
* **Architecture:**
  - Created `infrastructure/azure/main.parameters.production-mainnet.json`, `infrastructure/azure/relay-service.parameters.production-mainnet.json`, and `infrastructure/azure/solid-server.parameters.production-mainnet.json` targeting isolated resource group `rg-nodezero-social-production-mainnet`.
  - Authored dedicated GitHub Actions release workflow `.github/workflows/production-deploy.yml` with strict `main` branch gating, fail-closed preflight gates, and OIDC Azure authentication.
* **Target Files:**
  - `infrastructure/azure/main.parameters.production-mainnet.json`
  - `infrastructure/azure/relay-service.parameters.production-mainnet.json`
  - `infrastructure/azure/solid-server.parameters.production-mainnet.json`
  - `.github/workflows/production-deploy.yml`
* **Acceptance Criteria:**
  - Validated by workflow dispatch schema and Bicep parameters compilation.

#### Milestone 5.3 — Final UAT, Security Audit & Public Domain Cutover
* **Objective:** Execute production cutover to apex domain `https://nodezero.social`.
* **Architecture:**
  - Executed production dependency and vulnerability audit via `scripts/qa/validate-production-audit.mjs` (`0 high, 0 critical`).
  - Validated 22 policy vectors across 10 security categories (`policy:validate-consentful-discovery`, `policy:validate-env`, `policy:validate-pwa`, `policy:validate-attestation-fail-closed`).
  - Verified multi-account identity isolation across 45/45 device evidence assertions (`test:device-evidence`).
* **Target Files:**
  - `scripts/qa/validate-production-audit.mjs`
  - `scripts/policy/validate-env-isolation.sh`
* **Acceptance Criteria:**
  - All policy, audit, and quality suites pass with 0 warnings/errors.

---

## 5. Summary Matrix & Milestone Deliverables

| Phase | Milestone | Deliverable / Output | Status |
|---|---|---|---|
| **Phase 1** | M1.1 | Remote LDN Outbox Delivery Worker (`@nodezero/solid-pod-sync`) | 🟢 Complete |
| **Phase 1** | M1.2 | Waku Message Store Sync on reconnect (`@nodezero/waku-comms`) | 🟢 Complete |
| **Phase 1** | M1.3 | In-App Social Notifications (`@nodezero/notification-orchestrator`) | 🟢 Complete |
| **Phase 2** | M2.1 | Codify Relay Service in Bicep IaC (`infrastructure/azure`) | 🟢 Complete |
| **Phase 2** | M2.2 | Automated Zero-Retry Two-Device Physical UAT Suite (`scripts/qa`) | 🟢 Complete |
| **Phase 2** | M2.3 | Staging Soak & Performance Audit (`scripts/qa`) | 🟢 Complete |
| **Phase 3** | M3.1 | WebAuthn L3 PRF Passkey Hardware Vault (`@nodezero/embedded-wallet`) | 🟢 Complete |
| **Phase 3** | M3.2 | W3C `did:pkn` Soroban DID Document Resolver (`@nodezero/solid-pod-sync`) | 🟢 Complete |
| **Phase 4** | M4.1 | Logos Codex Decentralized Blob Storage Adapter (`@nodezero/solid-pod-sync`) | 🟢 Complete |
| **Phase 4** | M4.2 | Status Network L2 (Linea zkEVM) Settlement Rail (`packages/contracts`) | 🟢 Complete |
| **Phase 5** | M5.1 | Stellar Mainnet Contract Deployment (`packages/contracts`) | 🟢 Complete |
| **Phase 5** | M5.2 | Production Azure Environment & Pipeline (`infrastructure/azure`) | 🟢 Complete |
| **Phase 5** | M5.3 | Security Certification & Public Apex Launch (`https://nodezero.social`) | 🟢 Complete |
