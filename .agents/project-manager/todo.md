# Project Manager Todo Board

## Status legend
- TODO
- IN_PROGRESS
- BLOCKED
- DONE

## Milestone A: Build and release hygiene
- [DONE] A1: Normalize package scripts and fix manifest anomalies.
- [DONE] A2: Add CI pipelines for lint, type-check, test, contracts.
- [DONE] A3: Define release environment variable matrix for staging.

## Milestone B: Functional completion
- [DONE] B1: Replace feed placeholder with Solid-based aggregation. (merged to testnet: FOAF + Docustream feed aggregation)
- [DONE] B2: Replace local chat placeholder with live P2P relay flow. (merged to testnet: relay messaging with known-peer discovery)
- [DONE] B3: Deliver relay backend for SignalRelay endpoint. (merged to main: /health + /healthz + Dockerfile)
- [DONE] B4: Make Solid auth cross-platform safe for Expo web/native. (merged to main: IdP validation, env coherence, safer redirect)

## Milestone C: Chain and ZK reliability
- [DONE] C1: Harden contract deployment sequence and initialization. (merged to main: Lockb0x initialization-proof gate)
- [DONE] C2: Publish artifact manifest validation and checksum process. (merged to testnet: artifact checksum generate/verify script + manifest file)

## Milestone D: Azure staging readiness
- [BLOCKED] D1: Add custom domain/TLS configuration runbook. (Azure DNS zone + staging CNAME provisioned; blocked on correct Namecheap API user/API access or registrar NS delegation to Azure DNS)
- [DONE] D2: Add SWA publish workflow from Expo web build. (merged to main: build:web + SWA publish + landing smoke)
- [DONE] D3: Add monitoring/alerting and cost guardrails. (merged to testnet: workspace ingestion caps + optional action group/activity-log alert)

## Milestone E: Validation and launch
- [DONE] E1: End-to-end smoke suite and manual UAT checklist. (merged to main: scripts/qa/staging-smoke.sh + docs/staging-uat-checklist.md + qa:smoke)
- [DONE] E1b: Internal-session auth closeout alignment across app copy, runbook evidence, and roadmap attribution.
- [TODO] E2: Staging sign-off and release announcement.

## Milestone F: Multi-agent parallel delivery ops
- [DONE] F1: Add PM branch/worktree dispatch automation.
- [DONE] F2: Add PM merge-queue reintegration automation.
- [DONE] F3: Add PM status and follow-up control loop.
- [DONE] F4: Add bounded PM loop mode for recurring oversight.

## Milestone H: CI/CD Incident remediation (user-escalated P0)
- [DONE] H1: Fix pnpm version mismatch — upgrade CI to pnpm v11 in ci.yml and staging-deploy.yml. (commit 45263d7)
- [DONE] H2: Pin Rust toolchain — add packages/contracts/rust-toolchain.toml (Rust 1.81.0 stable). (commit 45263d7)
- [DONE] H3: Fix Namecheap API credentials — maintainer updated NAMECHEAP_API_KEY and NAMECHEAP_API_USER GitHub secrets. (2026-06-25)
- [DONE] H4: Branch governance — created `testnet` integration branch; dispatch/reintegrate scripts default to testnet; RUNBOOK section 6a documents new flow; branch protection rules set on main (enforcement limited to public-repo-only on Free plan). Agent work now targets testnet; PM opens testnet→main PRs after QA sign-off.

## Milestone I: Next sprint (testnet-first)
- [TODO] I1: Keep testnet current — merge main into testnet at start of each sprint.
- [TODO] I2: Agent branches created off testnet, not main.
- [TODO] I3: PM opens testnet→main PR only after QA_RELEASE_AGENT posts explicit PASS.

## Milestone J: QA-identified bug fixes and gap closures (2026-06-25)
- [DONE] J1: Fix wallet provisioning on web — Platform.OS === 'web' guard in WalletContext.tsx skips expo-secure-store on web. (commit 778c37f, testnet)
- [DONE] J2: Fix auth error message specificity — client-side empty URL and non-HTTPS checks in index.tsx. (commit 778c37f, testnet)
- [DONE] J3: Add favicon to Expo web export. Owner: MOBILE_APP_AGENT. (`web.favicon` configured in app.config.js + assets/favicon.png present)
- [IN_PROGRESS] J4: Complete LM1/LM2/WR2/AU4 authenticated UAT. (Relay recovered; LM1 passes with dev geolocation mock in harness; remaining blocker is LM2 two-client proof with distinct authenticated WebIDs)
- [DONE] J5: DOCS_AGENT to document confirmed functionality and gaps. (merged to testnet)
- [DONE] J6 (P1): Web navigation bar added to _layout.tsx — WebNavBar renders on Platform.OS==='web' when isLoggedIn. Feed/Local/Profile/Settings links with active state. (commit 9118ac7, merged to testnet)
- [DONE] J7 (P1): index.tsx redirect now guards on pathname==='/' — prevents authenticated users at /settings, /local, /profile from being bounced to /feed. (commit 9118ac7, merged to testnet)
- [DONE] G1: Author open-source community health files (LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue templates, PR template). (merged to main)
- [DONE] G2: Build GitHub Wiki with architecture overview, feature guides, getting-started, API references, and roadmap. (merged to main with wiki/_Sidebar.md navigation)
- [DONE] G3: Playwright-validated walkthroughs with screenshots and video embedded in Wiki pages. (merged to main with docs/screenshots/README.md index)

## Milestone K: Lockb0x attestation implementation (2026-06-26)
- [DONE] K1: Rewrite PoH-first documentation and product copy to lockb0x attestation scope. Owners: DOCS_AGENT, MOBILE_APP_AGENT, STELLAR_CONTRACT_AGENT.
- [DONE] K2: Wire onboarding flow to register WebID<->Stellar pairing and persist attestation inputs. Owners: MOBILE_APP_AGENT, SOLID_DATA_AGENT. (AT1 PASS on staging: tx `3dd6f3c11155bed556225efc56d5e939d955eccf7522a06208e75615e71bdb3b`)
- [DONE] K3: Add client-side chain reads for pairing verification (`get_webid`, `get_state_root`) with existing contracts only. Owner: STELLAR_CONTRACT_AGENT. (AT2 PASS on staging: WebID read + Lockb0x root `0000000000000000000000000000000000000000000000000000000000000001`)
- [DONE] K4: Implement returning sign-in pairing verification against lockb0x-root-backed attestation proof. Owners: MOBILE_APP_AGENT, SOLID_DATA_AGENT. (AT3 PASS on staging after reload)
- [DONE] K5: Validate staging deployment, UAT matrix, and release evidence for attestation flow. Owners: QA_RELEASE_AGENT, AZURE_PLATFORM_AGENT, DOCS_AGENT. (smoke PASS; AT1/AT2/AT3 PASS)

## Milestone L: UX Phase 1 full-featured application (2026-06-27, branch: feat/ux-phase1)
- [DONE] L1: Create new screen scaffolds: backpack.tsx, compose.tsx, docustream.tsx with mock state. Owner: MOBILE_APP_AGENT. (commit: 208e2b4, merged to feat/ux-phase1)
- [DONE] L2: Augment existing screens: feed.tsx (Algorithm Tuner modal), profile.tsx (Shared Threads + ZK badge), settings.tsx (no WebACL section found). Owner: MOBILE_APP_AGENT. (commit: 58014f8, merged to feat/ux-phase1)
- [DONE] L3: Navigation restructure (_layout.tsx) and npm dependency additions (@react-native-community/slider ^4.5.5, react-native-rss-parser ^1.5.1). Owner: MOBILE_APP_AGENT. (commit: 81ce1b0, merged to feat/ux-phase1)
- [DONE] L4: solid-pod-sync backend: updateWebACL(), findSemanticOverlap(), DocustreamManager.ts. Owner: SOLID_DATA_AGENT. (commit: c9a4425, merged to feat/ux-phase1)
- [DONE] L5: Context binding - wire Backpack/Docustream/Profile overlap to live backend methods. Owner: MOBILE_APP_AGENT. (commit: f9d8385, merged to feat/ux-phase1)
- [DONE] L6: Compose audience routing - local->P2PChannel, foaf->Pod encrypt, verified->ZK gate. Owner: P2P_RELAY_AGENT. (commit: dc8de39, merged to feat/ux-phase1)
- [DONE] L7: Phase 3 QA smoke - J1(Backpack/WebACL) J2(Docustream/Pod) J3(Compose/P2P) J4(Semantic Overlap). Owner: QA_RELEASE_AGENT. Reintegrated to testnet via merge commit d6eb8b9.

## Milestone M: Legacy onboarding notes (deprecated)
- [DONE] M1: Legacy CSS-optional bootstrap path is superseded by OIDC-only staging baseline; no active implementation work remains.

## Milestone N: Provisioning wait-state UX hardening (2026-07-25)
- [TODO] N1: Improve account provisioning progress UX for 30-60s waits by adding explicit step status text and a non-telemetry fallback rotator (short decentralized-web quotes) while Pod creation is in progress.

## Milestone O: Lockb0x V3 audit integration (2026-07-26)
- [DONE] O1: Configure AUDIT_AGENT and add the Testnet-only Factory V3 child-state auditor (`pnpm qa:audit:lockbox`).

## Milestone P: Attested authentication reliability refactor (2026-07-27)
- [DONE] P1: Centralize V3 canonical claim framing, bind claims/proofs to a fingerprinted onboarding descriptor, digest-verify proving/VK artifacts, and reject stale V3 configuration before CSS side effects.
- [DONE] P2: Add embedded provisioner build provenance, synchronous deployment verification, exact auth-created child audit correlation, and strict V3 constructor-state validation.
- [DONE] P3: Fail closed when an indexed wallet identity loses its secret; propagate a stable recovery-required broker error instead of silently replacing the key.
- [DONE] P3.5: Restore trustworthy quality gates before the provisioning saga: use the public circomlibjs Poseidon API with fixed vectors, fetch/checksum active V3 proof artifacts for tests, separate production/test lint policy, align TypeScript with typescript-eslint, and restore full workspace lint/type-check/test PASS.
- [TODO] P4: Implement durable provisioning reservations/saga with ETags, leases, response-loss reconciliation, and atomic credential/index publication. Owner: SOLID_DATA_AGENT.
- [TODO] P5: Implement encrypted recovery bundle v2 plus v1 import and inactive key restoration. Owner: MOBILE_APP_AGENT.
- [TODO] P6: Adopt the provisioner App Service into staged Bicep/slot deployment after no-op resource inventory and secret-continuity proof. Owner: AZURE_PLATFORM_AGENT.
- [TODO] P7: Expand zero-retry browser/device E2E, rollback rehearsal, orphan reconciliation, and 24-hour observation. Owner: QA_RELEASE_AGENT + AUDIT_AGENT.

## Milestone Q: Consentful discovery and communication (2026-07-31)
- [DONE] Q0: Memorialize the approved system description, consent architecture ADR, implementation plan, architecture boundaries, agent instructions, PM board, and validation gates. Owners: PROJECT_MANAGER + DOCS_AGENT. Evidence: canonical docs created, agent layers synchronized, and `pnpm pm:dispatch:dry` passed.
- [DONE] Q1A: Add versioned discovery, relationship, moderation, receipt, and replay contracts; Pod layout; managers; public Type Index registration; and fixtures. Owner: SOLID_DATA_AGENT. Depends on Q0. Evidence: consent contracts, conservative transitions, six consent containers, public-append inbox ACL, RDF discovery/relationship/moderation managers, Type Index adapter, factory exports; 18 suites/104 tests PASS, type-check PASS, lint zero errors (one unrelated pre-existing warning).
- [DONE] Q1B: Add WebID/LDN discovery and delivery adapters, session-bound Pod proxy enforcement, and credential-free SSRF-safe external fetch. Owner: SOLID_INTEGRATION_SPECIALIST. Evidence: DNS-pinned HTTPS-only GET/POST with safe redirect/size/media/timeout controls; no caller authorization-header input; WebID RDF/Link/Type Index discovery; strict ActivityStreams adapter; actor-bound authenticated delivery route; Pod proxy sibling/traversal denial; Solid 20 suites/114 tests and provisioner 88/88 tests PASS, touched-file lint/type-check PASS.
- [TODO] Q1C: Publish executable security test vectors for inbox ACLs, external fetch, replay, sender verification, privacy, migration, and block precedence. Owner: AUDIT_AGENT. Depends on Q0.
- [DONE] Q2: Implement reciprocal relationship lifecycle, replay ledger, legacy `foaf:knows` migration, moderation state, and compatibility projection. Owner: SOLID_DATA_AGENT. Depends on Q1A/Q1B. Evidence: private consent/outbox/receipt/replay/quarantine stores; signed recipient-bound Follow/Accept/Reject/correlated Undo delivery; authenticated recipient verification; bounded inbox sync and cleanup; actor/recipient/time/replay/block checks; lazy legacy import; accepted-only FOAF projection preserving unrelated RDF; default-off Profile request controls; accepted-and-unblocked compose policy; immutable retry; Solid 155/155, mobile 87/87, provisioner 92/92 tests, strict staging PWA build/artifact, and environment policy PASS. No deployment performed; Q1C abuse/rate-limit vectors remain open.
- [TODO] Q3A: Add durable derived-index infrastructure, default-off flags, privacy-safe telemetry, retained slots/revisions, and rollback assets. Owner: AZURE_PLATFORM_AGENT. Depends on Q1 contracts and P6.
- [TODO] Q3B: Add user consent controls, selected public interests, explainable recommendations, and unified Directory/Profile/Local actions. Owner: MOBILE_APP_AGENT. Depends on Q2 and Q3A API contract.
- [TODO] Q3C: Enforce consent and block policy in Presence, Waku, WebRTC, and relay paths; add abuse and lifecycle tests. Owner: P2P_RELAY_AGENT. Depends on Q1 contracts.
- [TODO] Q4: Add consent policy validation, behavior-complete smoke, zero-retry two-account/browser/device coverage, deployment certification, rollback, and soak. Owner: QA_RELEASE_AGENT. Test design begins after Q0; final execution depends on Q1-Q3.
- [TODO] Q5: Publish validated Wiki/status updates and a new Milestone Q release evidence summary. Owner: DOCS_AGENT. Depends on Q4 PASS and AUDIT_AGENT GO.
- [TODO] Q6: Keep email social notifications disabled unless an independent email-channel consent design is approved. Owners: SOLID_DATA_AGENT + AZURE_PLATFORM_AGENT.
