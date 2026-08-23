# NodeZero Social — Featureset Status Review and Production Roadmap

Date (UTC): 2026-08-19
Prepared as: full-repository code and deployed-artifact audit (not a marketing summary)
Environment scope: `staging-testnet` (canonical PWA `https://staging.nodezero.social`); `production-mainnet` is not implemented
Reviewed against: `docs/system-description.md`, `docs/architecture.md`, `docs/adrs/consentful-discovery-communication/ADR-001-consentful-discovery-and-communication.md`, `docs/consentful-pod-owner-discovery-and-communication-plan.md`, `docs/staging-runtime-implementation-roadmap.md`, `docs/staging-uat-checklist.md`, `docs/milestone-i-release-evidence-summary.md`, `docs/milestone-q-delta-release-runbook.md`, and current package source (`packages/mobile-app`, `packages/jss-provisioner`, `packages/solid-pod-sync`, `packages/waku-comms`, `packages/p2p-comms`, `packages/relay-service`, `packages/notification-orchestrator`, `packages/contracts`, `packages/zk-crypto`, `packages/embedded-wallet`, `packages/geo-discovery`).

> Historical evidence documents (Milestone G/H/I/Q evidence summaries) describe the release at their recorded date and are intentionally not rewritten. This review is a fresh, current-state audit layered on top of them.

---

## 1. Executive Summary

- The **identity/session foundation is production-shaped and release-gated**: internal Stellar-signature authentication, Pod provisioning, V3 lockb0x on-chain attestation, and multi-account disambiguation are implemented in code, covered by unit/integration tests, and are the one **blocking** CI gate (`pnpm qa:smoke:auth`) in `staging-deploy.yml`.
- The **Solid Pod layer is the stable foundation** the user's direction correctly identifies: profile, DocuStream, social graph, relationship lifecycle, moderation, and Type Index/LDN plumbing are implemented in `@nodezero/solid-pod-sync` and `@nodezero/jss-provisioner` with substantial test coverage (168+101+119 tests recorded at Q2/Q3 local evidence).
- The **Directory, Discovery, and inter-personal (relationship/Trust Circle/messaging) feature set — Milestone Q — is implemented in code and locally validated, but has never been deployed live to staging with its flags enabled.** This is the single biggest gap between "built" and "shipped": Q3A/Q3B/Q3C are "complete locally" with Agent GO, but Q4 (staging deployment + zero-retry two-account device journeys + rollback rehearsal + soak) is still open, and every Q feature flag (`directory`, `peer-profile`, `relationship`, `transport`) remains dark in the last recorded deployment marker.
- **Broadcast/DM delivery for non-local (Waku/relay) participants is explicitly partial** — local Waku broadcast works; complete non-local recipient inbox delivery does not yet exist end-to-end.
- **Social notifications are scaffolded, not wired to relationship/message events** — the orchestrator currently only handles provisioning lifecycle events and digests.
- **Production Mainnet has no implementation**: no mainnet contracts, no mainnet infra, no mainnet-only credentials, and staging scripts explicitly refuse to target mainnet or the production domain.
- Net assessment: the app has **two nearly-complete tiers** (identity/Pod-foundation = shippable; Directory/Discovery/Communication = code-complete but undeployed) and **one not-yet-started tier** (Production Mainnet cutover). The fastest path to a Production Release Candidate is deploying and certifying the already-built Milestone Q feature set on staging, then executing a scoped, separately-gated Mainnet migration — not building new features.

---

## 2. Featureset Status Matrix

Legend: 🟢 Implemented & release-gated (deployed/validated on staging) · 🟡 Implemented in code, locally validated, not yet deployed/enabled on staging · 🟠 Partial (some paths implemented, known gaps) · ⚪ Scaffolded/stubbed only · 🔴 Not implemented

| # | Feature area | Status | Evidence in code | Deployment/runtime evidence |
|---|---|---|---|---|
| 1 | Internal Stellar authentication (challenge/sign/session) | 🟢 | `packages/jss-provisioner/src/index.ts` (`/v1/auth/stellar-challenge`, `/v1/auth/stellar-token`), `packages/mobile-app/src/auth/useStellarSignIn.ts`, `NodeZeroSessionContext.tsx` | Blocking gate `pnpm qa:smoke:auth`; Milestone I evidence PASS 2026-07-30 |
| 2 | Multi-identity / multi-account disambiguation | 🟢 | `index.ts:2505-2640` (`409 account_selection_required`), `useStellarSignIn.ts` (`AccountSelectionRequiredError`), `mobile-app/app/index.tsx` account modal (`~L1358+`) | Covered by `index.session.test.ts`; UAT row AU3b (re-run required post-cutover, not a code gap) |
| 3 | Seamless onboarding ("Create Your Node") | 🟢 | `packages/mobile-app/src/onboarding/seamlessSignup.ts`, `solidAccount.ts`, `treasuryCreateAccount.ts` | `solid-account-endpoint-smoke.mjs` PASS 2026-06-29; Milestone I journey PASS |
| 4 | Pod provisioning + Pod Access Proxy (`/v1/pod-proxy/*`) | 🟢 | `packages/jss-provisioner/src/*`, CSS on Azure Container Apps (`infrastructure/azure/solid-server.bicep`) | Live resource `nz-staging-testnet-solid` confirmed in roadmap doc |
| 5 | V3 lockb0x ZK ownership attestation | 🟢 | `packages/zk-crypto/src/pod-ownership-prover.ts`, `packages/jss-provisioner/src/lockboxFactory.ts`, `attestationAnchor.ts` | `qa:audit:lockbox`; UAT AT1-AT3 PASS 2026-06-26 |
| 6 | Profile + DocuStream Pod persistence | 🟢 | `ProfileManager.ts`, `DocustreamManager.ts` | Mobile-validated, survives sign-out/reopen (Milestone I) |
| 7 | Social graph / relationship lifecycle (request/accept/reject/cancel/disconnect) | 🟡 | `packages/solid-pod-sync` relationship stores, `packages/mobile-app/src/social/relationshipRequestFlow.ts`, `relationshipInboxSync.ts`, `relationshipSenderVerifier.ts` | Q2 evidence: solid-pod-sync 168 tests, mobile 90, provisioner 101 — all local; **no staging deployment with flags on** |
| 8 | `foaf:knows` legacy migration + compatibility projection | 🟡 | Q2 evidence in `consentful-pod-owner-discovery-and-communication-plan.md` | Local only |
| 9 | Community Directory (listing, indexing, refresh, pagination, tombstones) | 🟡 | `packages/jss-provisioner/src/communityDirectory*.ts`, `packages/mobile-app/src/directory/*` (directoryPageClient, directoryFeatureClient, directoryPublication, discoveryPreferences) | `qa:smoke:community-directory` PASS locally for tab order; durable Azure Table backend implemented; **directory flag dark in last deployed marker** |
| 10 | Explainable recommendations (reason codes) | 🟡 | `directory/entryBuilder.ts`, plan Phase 3 item 6 | Local only |
| 11 | Trust Circle (explicit audience curation) | 🟡 | `packages/mobile-app/src/social/trustCircleStore.ts`, `trustCirclePersistence.ts` | Directory-embedded actions exist; not deployed enabled |
| 12 | Directed compose / recipient resolution (accepted+unblocked only) | 🟡 | `packages/mobile-app/src/social/composeRecipients.ts`, `composeAudience.ts`, `directedCommunicationPolicy.ts` | 22/22 consent-policy vectors pass locally (`policy:validate-consentful-discovery`) |
| 13 | Moderation (mute/block/report) + block precedence | 🟡 | `moderationEvents.ts`, `personActionPolicy.ts` | Local Audit Agent GO; block-precedence vectors pass |
| 14 | Nearby presence / ephemeral reveal (H3 + Waku) | 🟠 | `packages/geo-discovery/`, `packages/waku-comms/src/presence.ts` | UAT LM1 partial — requires browser location grant; transport flag dark |
| 15 | Local P2P messaging (WebRTC signaling) | 🟢 (local only) | `packages/p2p-comms/`, `packages/relay-service/` | UAT LM1/LM2 PASS 2026-06-28; relay confirmed live but **not codified in IaC** (Track 3 risk) |
| 16 | Waku DM / broadcast (identity-bound, encrypted) | 🟠 | `packages/waku-comms/src/dm-cipher.ts`, `chat.ts`, `WakuTransport.ts` | Local Waku broadcast works; **non-local compose lacks complete recipient inbox delivery** (explicit system-description gap) |
| 17 | LDN inbox discovery/delivery + credential-free SSRF-safe fetch | 🟡 | `packages/jss-provisioner/src/relationshipDelivery.ts`, `publicPeerProfile.ts` | Q1B: 20 suites/114 Solid tests + provisioner 88/88 pass locally |
| 18 | Social notifications (relationship/message events) | ⚪ | `packages/notification-orchestrator/src/orchestrator.ts`, `provisionerWebhook.ts` | Handles only provisioning lifecycle + digests; relationship/message event wiring not implemented |
| 19 | Milestone Q staging deployment (flags enabled, cohort rollout) | 🔴 (not yet executed) | N/A — deployment event | Runbook `milestone-q-delta-release-runbook.md` Phase 4 blocked on 5 staging secrets (`JSS_Q_COHORT_KEY`, `JSS_Q_COHORT_HASHES`, etc.) per repo memory |
| 20 | Zero-retry two-account device/browser journeys (Q4) | 🔴 | N/A | Not run; explicit Q4 blocker in plan |
| 21 | Production Mainnet (contracts, infra, keys, release process) | 🔴 | `deployments/*.json` are all testnet; no mainnet Bicep params in use | `main.parameters.example.json` explicitly forbidden for real deploys |
| 22 | Relay service IaC codification | 🔴 | Relay resources (`S2`/`S3`) confirmed live but absent from Bicep/workflows | `staging-runtime-implementation-roadmap.md` INF-08 open |
| 23 | Environment isolation policy enforcement | 🟢 | `scripts/policy/validate-env-isolation.sh`, `pnpm policy:validate-env` | Passing gate, referenced across all workflows |

---

## 3. Deep Dive: User Onboarding and Multi-Identity

### 3.1 Purpose

NodeZero's onboarding model exists to satisfy a specific product constraint: **the user's only credential is a device-held Stellar Ed25519 keypair — there are no user-facing passwords, and the browser never talks to the Solid Pod host directly.** Multi-identity support exists because a single physical device/Stellar keypair can be reused to create more than one NodeZero account over time (e.g., a test account, a recovered account, or a second persona), and the system must let a returning user disambiguate which Pod/WebID they mean to sign into — without ever falling back to an external identity provider, password, or OIDC redirect.

This matters directly to the requested focus area: Directory, Community, and Discovery all key off of **WebID identity**. A user's discoverability, relationship state, and Trust Circle membership are all Pod-scoped to one specific WebID. Multi-account support is therefore a prerequisite correctness property for Discovery — the app must always resolve to *exactly one* unambiguous Pod identity before any directory listing, relationship, or messaging action is attempted.

### 3.2 How it works (implementation)

**New-user creation** (`packages/mobile-app/src/onboarding/seamlessSignup.ts`):
1. User provides a handle/email and taps "Create Your Node."
2. The device generates a Stellar keypair locally (secret stored encrypted in profile-scoped IndexedDB — never leaves the device).
3. The provisioner (`packages/jss-provisioner`) creates a Solid Pod + WebID on the Node Zero Community Server, deploys/initializes a per-user Soroban lockb0x contract, and anchors an encrypted ZK ownership proof on-chain.
4. An inline NodeZero session (opaque bearer + host-only cookie) is issued directly — no redirect leg.

**Returning sign-in** (`packages/mobile-app/src/auth/useStellarSignIn.ts` + `packages/jss-provisioner/src/index.ts`):
1. Client calls `POST /v1/auth/stellar-challenge` with the device's Stellar public key.
2. The device signs `{ nonce, stellarPublicKey, audience }` on-device (private key never transmitted).
3. Client calls `POST /v1/auth/stellar-token` with the signature. The provisioner:
   - Verifies the Ed25519 signature against the issued challenge.
   - Looks up **all** stored credential records for that Stellar public key via `credentialStore.findAllByStellarPublicKey(...)`.
   - If **zero** records exist → `401 no_account` (`NoAccountError` client-side), directing the user to Create Your Node.
   - If **exactly one** record exists (or the client already supplied a `webId`) → proceeds directly to session issuance.
   - If **more than one** record exists and no `webId` was supplied → returns `409 account_selection_required` with the candidate `{ webId, podUrl }` list. The client throws `AccountSelectionRequiredError` carrying that list.
4. The mobile app (`packages/mobile-app/app/index.tsx`, "Multi-account selector" modal, ~line 1358) catches `AccountSelectionRequiredError` and renders an **internal account chooser modal** — a list of the candidate WebIDs/Pod URLs with select/confirm actions. No external IdP page, no redirect.
5. The user selects an account; the client retries `stellar-token` with the chosen `webId`. The provisioner matches it against the candidate set (`404 account_not_found` if it doesn't match) and, on match, proceeds through the same fail-closed session-issuance path as a single-account login: mint a live Solid client-credential token, probe the Pod, issue the session **only if both succeed**.

**Fail-closed invariant**: session issuance requires (a) a valid Stellar signature, (b) a matching stored credential, (c) a successful live Solid token mint, and (d) a successful Pod probe. Any failure returns `401`; there is no partially-authenticated state. This is enforced identically whether zero, one, or many accounts are associated with the device key.

### 3.3 Where it's tested

- `packages/jss-provisioner/src/index.session.test.ts` and the `runtime-v3-secure` mirror both assert `code === 'account_selection_required'`.
- `docs/staging-uat-checklist.md` row **AU3b** is the manual/E2E counterpart; `scripts/qa/staging-auth-evidence.mjs` (lines ~299-303) automates it as part of the blocking `pnpm qa:smoke:auth` gate, asserting the chooser surfaces and that selecting a WebID signs into that exact account.

### 3.4 Status

🟢 Implemented, tested, and part of the **one blocking identity gate** in `staging-deploy.yml`. The UAT checklist marks AU3b "RE-RUN REQUIRED (cutover)" only because the passwordless cutover changed the surrounding auth surface, not because the multi-account code path itself is unvalidated — it has direct unit-test coverage and an automated evidence script.

---

## 4. Deep Dive: Directory, Community, Discovery, and Inter-Personal Features

This is the area the requested direction targets next, and it is **substantially built already** — the work remaining is deployment, cohort rollout, and hardening, not net-new architecture.

### 4.1 Architectural model (from ADR-001 / system-description / plan)

Six independent, default-off consent axes govern all discovery/communication, and none of them alone grants another axis:
1. **Public listing** (Community Directory membership)
2. **Public indexing** (searchable projection of listing)
3. **Nearby presence** (H3 geospatial + Waku ephemeral reveal)
4. **Inbound contact requests** (LDN inbox acceptance)
5. **Local broadcast participation** (Waku)
6. **Notification channels** (in-app; email intentionally excluded pending separate design)

The Pod is authoritative for consent, relationship, and moderation state; the **Community Directory is a rebuildable, non-authoritative projection** derived only from explicitly published public manifests. A local **block** overrides every other path (Solid, LDN, Waku, WebRTC, relay, compose, rendering) — this precedence is one of the audited security invariants (22/22 vectors in `policy:validate-consentful-discovery`).

Directed communication (DMs, targeted compose audiences, Trust Circle recipients) requires an **accepted and unblocked relationship** — directory membership, recommendations, geolocation permission, and unilateral legacy `foaf:knows` never by themselves authorize contact. This is enforced centrally in `packages/mobile-app/src/social/composeRecipients.ts` / `directedCommunicationPolicy.ts`, referenced explicitly in both the repo instructions and the system description as the single choke point for recipient eligibility.

### 4.2 What exists in code today

**Directory (`packages/jss-provisioner/src/communityDirectory*.ts` + `packages/mobile-app/src/directory/*`)**
- Durable, partition-isolated Azure Table-backed directory store with hashed row keys, ETag-fenced monotonic writes, equal-time opt-out precedence, bounded scans, and immediate in-process suppression of opt-outs even under persistence failure.
- Session-authenticated `POST /v1/community-directory/refresh` (owner-derived only from a valid session — no internal-key mutation path).
- Client-side directory feature/page clients, avatar client, publication maintenance UI component, discovery-preference persistence (listing/indexing/nearby/broadcast/interests as independently toggleable, three-way-merged across devices so a stale device can't resurrect a fresher opt-out).
- Dedicated `/directory` route in the mobile app, positioned between Feed and Backpack in nav (`pnpm qa:smoke:community-directory` verifies tab order/availability).

**Relationships and safety (`packages/solid-pod-sync` + `packages/mobile-app/src/social/*`)**
- Full ActivityStreams-shaped `Follow`/`Accept`/`Reject`/`Undo` lifecycle with replay suppression, actor/recipient correlation, quarantine of malformed/unverifiable activities, and idempotent state transitions (pending/accepted/rejected/cancelled/disconnected/muted/blocked).
- Recipient-bound, short-lived delivery assertions (dedicated provisioner signing key, payload digest, recipient/actor/activity-id/issuer/expiry) so the LDN delivery boundary never carries Pod session credentials.
- Lazy migration of legacy `foaf:knows` to `legacy-connected`, with accepted-only compatibility projection back to `foaf:knows` (unrelated RDF preserved).
- `useConnections.ts`, `relationshipRequestFlow.ts`, `relationshipInboxSync.ts`, `relationshipSenderVerifier.ts`, `personActionPolicy.ts`, `moderationEvents.ts`, `trustCircleStore.ts` / `trustCirclePersistence.ts` give the mobile app a unified Directory/Profile/Local action surface (Request, Accept, Decline, Cancel, Disconnect, Message, Trust Circle, Mute, Block, Report) sharing one policy.

**Nearby / ephemeral transport (`packages/waku-comms`, `packages/geo-discovery`, `packages/p2p-comms`, `packages/relay-service`)**
- H3-based local discovery utilities.
- Waku envelope signing/encryption bound to authenticated Stellar identity and provisioner assertions (`presence.ts`, `dm-cipher.ts`, `envelope.ts`), with relay admission requiring a nonce signed by the assertion-bound key.
- Local WebRTC signaling relay is live and functionally validated (UAT LM1/LM2) but **its Azure deployment lifecycle is not codified in IaC** — a real operational risk flagged in the roadmap doc (Track 3).
- **Known incomplete path**: non-local (Waku-routed) broadcast composing does not yet guarantee complete recipient inbox delivery — this is stated directly in `docs/system-description.md`'s capability table and not contradicted anywhere in code-level evidence gathered.

**Notifications (`packages/notification-orchestrator`)**
- `orchestrator.ts` / `provisionerWebhook.ts` currently process **provisioning lifecycle events and digests only**. There is no wiring yet from relationship-request/accept/message events into user-facing in-app notifications — this is an explicit, still-open Phase 4 item in the Q plan ("Add in-app social notifications only after durable inbox processing works").

### 4.3 Validation status (local, per Q-series evidence)

| Package | Local test evidence |
|---|---|
| `@nodezero/solid-pod-sync` | 31 suites / 168 tests |
| `@nodezero/mobile-app` | 90-119 tests across Q2/Q3B/Q3C increments |
| `@nodezero/jss-provisioner` | 101-136 tests across Q2/Q3A increments |
| `@nodezero/waku-comms` | 55 tests |
| `@nodezero/relay-service` | 3 tests |
| Security/consent | 22/22 vectors (`policy:validate-consentful-discovery`) across inbox ACL, SSRF, replay, sender verification, privacy, migration, block-precedence |

All of the above are recorded as **local** GO from the Solid Data, Mobile App, P2P Relay, Azure Platform, and Audit specialist roles. **None of it has been exercised through a live staging deployment with the corresponding feature flags turned on** — the last recorded deployed marker (`5d0d3532b...` per the delta runbook, and the 2026-08-05 dark deployment noted in repo memory) keeps `directory`, `peer-profile`, `relationship`, and `transport` flags **false**.

### 4.4 What's blocking activation (Q4, per the runbook)

1. Candidate provenance: `testnet` branch must be clean and exactly synced to `origin/testnet`.
2. Successful `staging-deploy.yml` run for the exact candidate SHA, matching live deploy marker.
3. Durable Directory: Azure Table backend health, opt-out race tests, consent policy pass in the deployed environment (not just locally).
4. Relay identity: relay health reachable, transport still dark, exact relay payload matches candidate.
5. Rollback rehearsal: retained bundle restoration proven for both directions.
6. **Zero-retry two-account User A/User B physical iOS and Android journeys** — this has not been executed.
7. 24-hour soak or one full expiry interval with no severity-1/2 regression.
8. Per repo memory: cohort rollout is additionally blocked on **five staging environment secrets** (`JSS_Q_COHORT_KEY`, `JSS_Q_COHORT_HASHES`, and related) that must be bootstrapped via `pnpm qa:bootstrap:directory-cohort -- --apply` before `directory_rollout=cohort` can be set.

---

## 5. Supporting Layers (brief)

| Layer | Status | Notes |
|---|---|---|
| Stellar contracts (`packages/contracts`) | 🟢 Testnet-live | `NodeZeroIdentity`, `Lockb0x`, `Lockb0xFactory` v2 deployed and recorded in `deployments/stellar-testnet.contracts.json`; no mainnet equivalents exist |
| ZK proof pipeline (`packages/zk-crypto`) | 🟢 | Browser-generated Groth16 proof of Pod ownership; artifacts published to blob storage (A1) |
| Embedded wallet (`packages/embedded-wallet`) | 🟢 | Key management + Stellar invocation helpers used by onboarding/sign-in |
| Azure infra (`infrastructure/azure`) | 🟠 | Baseline stack (SWA, provisioner, CSS, Key Vault, App Insights) is IaC-owned and live; relay is live but **not IaC-owned** (INF-08 open); alerting email unset (INF-10 open) |
| CI/CD | 🟢 for baseline auth/Pod path; 🟡 for Q-series | Three deployment tracks exist (Track 1 automated, Track 2 manual Solid stack, Track 3 fully manual relay) — Track 3 is flagged as the highest operational risk in the roadmap doc |

---

## 6. Gaps, Risks, and Debt (ranked)

1. **Relay lifecycle has no IaC/recovery path.** A resource-group-level incident could delete `S2`/`S3` with no automated recreation. Must be closed before Directory/nearby-presence cohort rollout, since Trust Circle/DM paths depend on relay availability.
2. **Non-local broadcast delivery is incomplete.** Composing an audience beyond locally-present peers does not guarantee inbox delivery today. This directly affects any "Community"-scale (non-proximity) messaging promise.
3. **Social notifications aren't wired to the events that matter.** Users accepting/receiving relationship requests or messages get no in-app notification signal yet — this will read as a broken/silent product experience once Directory is live.
4. **Zero staging exercise of the entire Milestone Q surface under load with real two-party device journeys.** All the "complete locally" status lines are a meaningful trust signal but are not release evidence.
5. **Config/secret drift risk**: provisioner app settings (JSS_* values) are applied ad hoc outside IaC/workflow (`staging-runtime-implementation-roadmap.md` §5) — a real source of "works on staging until someone touches it manually" incidents, and the Q cohort secrets add five more entries to this same non-codified surface.
6. **Production Mainnet is a from-scratch project**, not a flip of a flag: separate contracts, separate keys/treasury, separate provisioner credential store, separate Bicep parameter file (the example file is explicitly forbidden for real use), and a full new release-evidence trail.

---

## 7. Updated Roadmap and Strategy: Path to a Production Release Candidate

Given the user's stated direction — Solid Pod foundation is stable, next priority is Directory/Community/Discovery/inter-personal — the roadmap below sequences work so nothing new is architected before what's already built is proven in a live environment.

### Phase A — Close the Milestone Q activation gap (Directory/Discovery go live on Testnet)
Goal: turn "complete locally" into "deployed, cohort-validated, evidence-recorded."
1. Codify relay deployment in IaC (closes INF-08) — required before any nearby-presence/DM cohort exposure, since it's the least-recoverable piece of infrastructure in play today.
2. Add provisioner/relay app settings (including the five Q cohort secrets) to the deploy workflow instead of ad hoc `az webapp config appsettings set` (closes INF-09 and the drift risk called out above).
3. Run `pnpm qa:bootstrap:directory-cohort -- --apply`, populate `JSS_Q_COHORT_KEY`/`JSS_Q_COHORT_HASHES` as GitHub environment secrets.
4. Execute the Milestone Q Delta Release Runbook exactly as written: baseline capture → dark deploy → staged cohort enablement in the documented order (directory → relationship requests → safety controls → recommendations → nearby presence/reveal → DMs/local broadcast → in-app notifications).
5. Run the zero-retry two-account physical iOS/Android journeys and the 24-hour soak; obtain explicit PM + QA Release + Audit GO.
6. Publish a Milestone Q release-evidence summary (mirroring the Milestone I format) — this becomes the new canonical "what's actually live" reference.

### Phase B — Complete the inter-personal loop (fill the two known functional gaps)
1. Implement complete non-local recipient inbox delivery for broadcast/compose (the explicit "Broadcast: Partially implemented" gap) so Community-scale messaging isn't proximity-limited.
2. Wire relationship-request and message events into the notification orchestrator (currently only provisioning lifecycle/digests) so acceptance/reply/request events produce actual in-app notifications.
3. Extend UAT with the separate consent/relationship/safety/nearby/communication/revocation case IDs called for in Phase 5 of the Q plan, and keep them out of the identity-only `qa:smoke:auth` gate.

### Phase C — Harden for scale and abuse resistance
1. Load/soak the Directory Azure Table backend past the bounded staging-cohort partition-scan strategy — the plan itself flags this as "approved only for the bounded staging cohort" and calls for versioned projection invalidation before wider rollout.
2. Expand relay/Waku abuse controls (rate limits, connection caps) beyond the current cohort-scale validation.
3. Revisit the Basic B1 App Service plan / lack of deployment slots — retained-artifact rollback is an accepted stopgap, not a scalable production rollback strategy; slot adoption or SKU change is explicitly deferred (P6) and needs an approval decision before Mainnet.

### Phase D — Production Mainnet cutover (separate, explicitly gated project)
This is intentionally sequenced last and is **not** implied to be close — it is out of scope for every milestone reviewed so far.
1. Stand up mainnet-lane infrastructure: separate resource group/environment profile (`production-mainnet`), separate Key Vault, separate Solid server instance or hosting decision, and a real (non-example) Bicep parameters file.
2. Deploy separate Mainnet Soroban contracts (`NodeZeroIdentity`, `Lockb0x`, `Lockb0xFactory`) with their own treasury/deployer keys; never reuse Testnet contract IDs, passphrases, or RPC endpoints (hard rule already encoded in `environment-isolation-matrix.md` and enforced by `scripts/stellar/deploy-testnet.sh` guards).
3. Re-run the full identity, Pod, and Milestone Q evidence trail against Mainnet with Mainnet-appropriate funding (no Friendbot — `JSS_TREASURY_FUND_MEMBERS` real-funding path).
4. Add mainnet-specific release gates: contract upgrade/rollback plan, treasury custody/ops runbook, and a formal go/no-go review distinct from staging sign-off.
5. Only after a stable Mainnet soak should DNS/domain cutover (`app.nodezero.social` or equivalent) and public release messaging occur.

### Sequencing rationale
Phases A and B directly execute the user's stated priority (ship the Directory/Community/Discovery/inter-personal layer that's already built on the stable Pod foundation) with the least net-new architecture. Phase C is inserted before Mainnet because none of the current implementation has been exercised past a small, hashed staging cohort, and Mainnet failure modes (real funds, real treasury, real users) are unforgiving of scale surprises. Phase D is scoped last and separately because every governing document in this repository (system description, ADR-001, the Q plan, and the environment isolation matrix) treats Production Mainnet as explicitly out of scope for all current milestones — it is a distinct project with its own contracts, keys, and release process, not a configuration flip.

---

## 8. Repository Hygiene and Artifact Cleanup

Completed 2026-08-23 as a repository-maintenance change:

- Removed generated scratch data, provisioner logs, deployment archives, Playwright traces, test reports, and stray root log files from all reachable git history.
- Rewrote and republished `main`, `testnet`, and `v0.2.0-testnet` with lease-protected force pushes. The current packed git history is approximately 9.23 MiB, down from the earlier 149.6 MiB repository object footprint.
- Added `scripts/policy/validate-repository-hygiene.mjs`, exposed as `pnpm policy:validate-repository-hygiene`, and made it an early CI check. It rejects tracked generated artifact paths and tracked files larger than 5 MiB.
- Expanded `.gitignore` coverage for scratch/log directories, deployment archives, Playwright traces, and root debug outputs. Local scratch data remains available for active debugging but is no longer versioned.

The history rewrite is complete on GitHub. Existing clones must re-clone or reset their local branches to the rewritten remote history before contributing. The remaining 2.4 MiB `.agents/shared-inbox/inbox.md` file is operational handoff history, not a generated build artifact; it should be rotated separately if its growth becomes a concern.

## 9. Source Index (for follow-up verification)

- Identity/session: `packages/jss-provisioner/src/index.ts`, `sessionTokens.ts`, `credentialStore.ts`; `packages/mobile-app/src/auth/useStellarSignIn.ts`, `src/contexts/NodeZeroSessionContext.tsx`, `app/index.tsx`
- Directory: `packages/jss-provisioner/src/communityDirectory.ts`, `communityDirectoryPersistence.ts`, `communityDirectoryRefresh.ts`; `packages/mobile-app/src/directory/*`
- Relationships/safety: `packages/mobile-app/src/social/*`
- Transport: `packages/waku-comms/src/*`, `packages/p2p-comms/`, `packages/relay-service/`, `packages/geo-discovery/`
- Notifications: `packages/notification-orchestrator/src/*`
- Contracts/ZK: `packages/contracts/`, `packages/zk-crypto/src/pod-ownership-prover.ts`, `deployments/stellar-testnet.contracts.json`
- Governance docs: `docs/system-description.md`, `docs/adrs/consentful-discovery-communication/ADR-001-consentful-discovery-and-communication.md`, `docs/consentful-pod-owner-discovery-and-communication-plan.md`, `docs/milestone-q-delta-release-runbook.md`, `docs/staging-runtime-implementation-roadmap.md`, `docs/staging-uat-checklist.md`, `docs/environment-isolation-matrix.md`
