# Changelog

All notable changes to NodeZero Social are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- Pod-authoritative discovery consent, public manifest, relationship, moderation,
  replay, receipt, quarantine, and Type Index contracts.
- Owner-controlled Community Directory listing/indexing with explicitly selected
  public interests, bounded cursor pages, ETags, explainable recommendations, and
  unified Directory/Profile/Local actions.
- Durable Azure Table Directory projection with ETag-fenced, consent-monotonic
  updates, immediate opt-out suppression, bounded scans, active readiness probes,
  default-off keyed cohorts, and aggregate-only telemetry.
- Signed relationship request/accept/reject/cancel/disconnect lifecycle with
  accepted-only `foaf:knows` compatibility projection and private mute/block/report
  controls.
- Identity-bound Waku envelopes, rotating commitment presence/reveal, accepted and
  unblocked DM enforcement, and proof-of-possession WebRTC relay admission.
- Exact-SHA provisioner/relay/PWA deployment provenance, 90-day retained rollback
  bundles, and guarded retained-artifact rollback with live per-file PWA validation.
- Q4 release preflight commands and a physical iOS/Android two-account manual test
  runbook.

### Changed

- NodeZero bearer credentials are attached only to the exact provisioner origin.
  Peer Profile reads now use an authenticated provisioner endpoint whose outbound
  public WebID fetch is credential-free and SSRF-resistant.
- Directory, peer Profile, relationship, and transport features deploy dark and
  require keyed cohort membership before use.
- Local disconnect and block decisions take effect before best-effort remote
  notification; same-runtime state is purged immediately and cross-device state is
  reconciled from the Pod.

### Security

- Added the 22-vector consentful discovery policy gate covering append-only inbox
  ACLs, replay races, SSRF/address bypasses, sender assertions, migration, manifest
  sanitation, and block precedence.
- Added bounded public-resource requests, request-body deadlines, per-identity route
  limits, verifier concurrency limits, Azure Table request deadlines, and relay
  admission limits.
- Rollback never enables Milestone Q flags and cannot recreate an opted-out listing
  through stale in-memory or out-of-order persisted state.

### Release Status

- Local implementation has Azure Platform, Mobile App, and Audit GO.
- Staging deployment, rollback rehearsal, zero-retry physical-device journeys, and
  soak remain Q4 gates. No release version or tag is assigned yet.

---

## [0.2.0-testnet] — 2026-07-30

Release milestone for the canonical single-origin NodeZero PWA on Stellar
Testnet. Authentication, encrypted wallet persistence, recovery, Pod-backed
profile/DocuStream continuity, and exact V3 lockb0x verification are release
gated and validated on a retained physical mobile browser.

### Added

- Installable PWA shell with manifest, service worker, offline shell, strict
  cache policy, canonical-origin routing, and deployment provenance marker.
- Encrypted profile-scoped IndexedDB wallet using a non-extractable AES-256-GCM
  wrapping key; wallet secrets never enter localStorage.
- Signed-out recovery-bundle import with environment/network validation.
- Exact-SHA physical-device evidence contract and fail-closed certification
  workflow for future device-cloud and installed-PWA lanes.

### Changed

- Testnet now uses `https://staging.nodezero.social` as its canonical PWA
  origin; `https://nodezero.social` redirects there for the Testnet release.
- Browser access/refresh tokens are memory-only. Session restoration uses an
  HttpOnly, Secure, host-only `__Host-` cookie on the provisioner API.
- Empty wallets now display explicit **Create a new identity** and **Restore
  from recovery bundle** actions instead of an indefinite loading label.
- DocuStream and profile data remain Pod-backed and are restored after browser
  close, returning one-tap sign-in, and lockb0x verification.

### Fixed

- Removed the cross-origin wallet broker and all wallet migration routes,
  protocols, DNS records, and deployment bindings.
- Hardened durable onboarding with chunked Azure Table reservation records,
  CSS Pod commit-before-timeout recovery, bounded Treasury transport retries,
  and deployment stabilization without a second App Service rollover.
- Corrected release evidence so identity, V3, DocuStream, and mashlib results
  are reported independently without sharing plaintext credentials.

### Security

- Browser wallet records are authenticated and encrypted at rest.
- Browser bearer credentials are not persisted in web storage.
- Browser-to-CSS requests remain embargoed; all Pod operations use the
  provisioner Pod Access Proxy.
- Returning sign-in remains fail-closed on the device-derived commitment versus
  the exact on-chain V3 lockb0x commitment.

### Evidence

- Automated staging release: GitHub Actions run `30599014484`, commit
  `77c95112157a8f2cb36710a99e1932eb6ebe5938`, conclusion `success`.
- Accepted retained-mobile journey: create node, save profile, add DocuStream
  RSS source, sign out, close/reopen browser, sign in, verify Feed, DocuStream,
  and Profile persistence.
- Physical device-cloud certification remains optional infrastructure and was
  not used to block this Testnet milestone.

---

## [0.0.3-testnet] — 2026-07-10

Milestone release for staging/testnet implementation alignment, with Community
Directory as a first-class route and hardened auth-gate reliability in CI.

### Added

- Dedicated Community Directory route and tab wiring between Feed and Backpack:
  - `packages/mobile-app/app/directory.tsx`
  - `packages/mobile-app/app/_layout.tsx`
- Shared audience resolution contract for Broadcast recipients:
  - `packages/mobile-app/src/social/composeRecipients.ts`
  - `packages/mobile-app/src/social/composeRecipients.test.ts`
- Trust Circle local persistence helper for social UX state:
  - `packages/mobile-app/src/social/trustCircleStore.ts`
- Directory acceptance evidence smoke script:
  - `scripts/qa/staging-community-directory-evidence.mjs`
  - root script `qa:smoke:community-directory` in `package.json`

### Additional stabilization updates

- Compose flow now consumes centralized recipient resolution for `foaf`,
  `verified`, and `local` modes, keeping recipients connection-driven even
  when Directory-only Trust Circle members exist:
  - `packages/mobile-app/app/compose.tsx`
- Staging workflow auth gate remains blocking and is now resilient to transient
  IdP/OIDC timing flake by allowing one retry before failing the run:
  - `.github/workflows/staging-deploy.yml`
- Repository instructions, docs, and wiki were refreshed to reflect current
  staging/testnet behavior and acceptance posture.

### Additional fixes

- Fixed workflow runtime configuration for provisioner health check to use
  supported Azure CLI parameters in staging deploy.
- Closed auth-gate instability observed in run `#45` by hardening CI auth-gate
  execution. Run `#46` completed with auth step success.

### Changed

- Docustream stream listing now supports Pod container responses in both JSON-LD and Turtle formats, with URL normalization and deduplication in `packages/solid-pod-sync/src/DocustreamManager.ts`.
- Docustream screen session handling now preserves usability while Solid OIDC restoration settles by using node-session WebID continuity and guarded route behavior in:
  - `packages/mobile-app/src/contexts/SolidContext.tsx`
  - `packages/mobile-app/app/_layout.tsx`
  - `packages/mobile-app/app/index.tsx`
- Docustream source management UX now uses safer modal/backdrop interaction and testable source controls (`testID` selectors) in `packages/mobile-app/app/docustream.tsx`.
- Profile save flow now uses effective WebID/session readiness checks and a deterministic re-auth recovery path before Pod writes in `packages/mobile-app/app/profile.tsx`.
- Profile tab now includes first-party social graph controls for contact list management (add/remove WebID connections) in `packages/mobile-app/app/profile.tsx`.
- Profile tab now includes a community directory surface that aggregates discoverable Node Zero Pod holder WebIDs and supports one-tap connect actions in `packages/mobile-app/app/profile.tsx`.

### Fixed

- Fixed staging issue where source ingestion succeeded but stream cards were not rendered because list parsing depended on Turtle-only container listings.
- Fixed Add Source auth-edge handling by adding explicit Solid re-auth initiation when write access is not ready or returns authorization failures.
- Improved source-registry write failure diagnostics to include HTTP status text, `www-authenticate`, and a response body snippet in `packages/solid-pod-sync/src/DocustreamSourceManager.ts`.
- Fixed profile edit save failures caused by transient session-restore windows by guarding write operations and prompting explicit sign-in recovery.
- Fixed Profile connection writes silently failing under node-session fallback by requiring authenticated OIDC session readiness for Pod writes in `packages/mobile-app/app/profile.tsx`.
- Fixed social graph read/write subject mismatch risk by normalizing owner subject handling (canonical profile WebID + legacy fallback) in `packages/solid-pod-sync/src/SocialGraph.ts`.
- Fixed stale-session connection add/remove recovery by forcing re-auth on auth-like write failures and surfacing operation status in `packages/mobile-app/app/profile.tsx`.

### Removed

- Removed temporary QA debug probes no longer needed after stabilization:
  - `scripts/qa/tmp-create-node-click-probe.mjs`
  - `scripts/qa/tmp-live-onboarding-debug.mjs`

---

## [0.0.2] — 2026-07-05

Release-close and documentation truth-sync for the live staging-testnet baseline.

### Added

- **Formal implementation + attribution register** in
  `docs/feature-implementation-attribution.md` covering:
  - Solid OIDC and Pod sync implementation references
  - Mashlib boundary rationale and current adapter state
  - Upstream project/library attributions and justification links
- **Wiki credits blocks** added to subsystem pages:
  - `wiki/Smart-Contracts.md`
  - `wiki/Solid-Pod-Sync.md`
- **Cross-links for attribution discoverability** from:
  - `README.md`
  - `wiki/Home.md`
  - `wiki/FAQ.md`

### Changed

- **Version bump:** root package version updated from `0.0.1` to `0.0.2`.
- **Detailed release/docs alignment** to current live implementation state, including:
  - Docustream RSS source management status (add/toggle/delete + ingest)
  - Staging readiness posture update (live with hardening backlog)
  - Runtime roadmap updates for current lockbox factory and app feature matrix
- **Deployment metadata and public references synchronized** across repo docs and manifests:
  - lockbox factory contract id: `CA5MASVC7CH646QUZM6HFC3JAYIG4TCRHJDSBDOBFP66IW7TXYYHFUVB`
  - lockbox factory wasm hash: `55bcb3a4c05ff935a421f10d1a72bdeb6e4573de8954e4fbd263f7ac88a8fbd9`
  - ZK verification artifact reference (`pod_ownership_vk.json` sha256)
- **Wiki refresh pass** to align platform pages (`Home`, `Roadmap`, `Mobile App`,
  `Smart Contracts`, `ZK Crypto`, `Azure Platform`) with the current v0.0.2
  runtime/deployment state.

### Fixed

- Corrected stale lockbox factory wasm hash references that still pointed to
  pre-attestation hash `795157cc...` in release-facing metadata/docs.
- Corrected stale contract-id references in release/runbook snippets where v1
  factory id values were still present.

### Removed

- Generated runtime artifacts from version control, including:
  - Playwright report/result payloads
  - Provisioner log download trees (`provisioner-logs*`)
  - Local deployment/export zip artifacts (`deploy.zip`, `dist.zip`)

### Security

- Strengthened repository hygiene by expanding `.gitignore` coverage for generated
  web bundles, logs, and test artifacts to reduce accidental inclusion of
  operational/debug outputs in future commits.

---

## [0.1.0-testnet] — 2026-07-01

First complete TestNet milestone. The ZK attestation stack is load-bearing and
proven end-to-end on live staging at `staging.nodezero.social`.

### Added

- **ZK Pod-ownership attestation** — browser generates a real `pod_ownership`
  Groth16 proof (snarkjs/WASM) binding the WebID/Pod to the device's Stellar
  keypair. `Poseidon(identitySecret)` is the public identity anchor.
- **`Lockb0x.set_attestation`** — new Soroban contract method stores the
  `accountCommitment` (Poseidon identity anchor, 32 bytes) plus the
  AES-256-GCM-encrypted attestation claim (on-chain, 4 KB cap). Wasm hash
  `55bcb3a4…`.
- **`LockboxFactory` v2** — `CA5MASVC7CH646QUZM6HFC3JAYIG4TCRHJDSBDOBFP66IW7TXYYHFUVB`,
  operator = Deployer account (`GDMJ3GFM…`).
- **Two-account funding model** — Treasury funds member account creation and
  tops up the Deployer (≥ 50 XLM); Deployer pays lockb0x gas. Pre-flight
  top-up is fail-closed before every lockb0x creation.
- **Treasury-sponsored member `CreateAccount`** — `POST /v1/create-account`
  (internal-key gated); onboarding auto-fund via `JSS_TREASURY_FUND_MEMBERS`.
- **On-chain encrypted attestation** — `get_account_commitment` and
  `get_attestation_ciphertext` readable by anyone; decryptable only by the
  Stellar keypair holder.
- **WebID profile-card anchor slot** — `nz:lockboxContract`,
  `nz:stellarAccount`, `nz:accountCommitment` triples PATCHed into
  `profile/card#me` at account creation (SPARQL `INSERT DATA`, DPoP).
- **On-return fail-closed attestation check** — browser derives
  `Poseidon(identitySecret)` and compares to on-chain `accountCommitment`
  every time a node session is loaded; mismatch refuses the session.
- **Seamless "Create Your Node" onboarding** — CSS Pod + per-user lockb0x
  provisioned in one HTTP call; onboarding is fail-closed at every step.
- **P3 provisioner regression tests** — `packages/jss-provisioner/src/`
  `treasuryCreateAccount.test.ts` (Node built-in test runner via `tsx`).
- **`@nodezero/zk-crypto` attestation-cipher module** — `encryptAttestation`,
  `decryptAttestation`, `verifyLoginAttestation`, `deriveAccountCommitmentHex`,
  `fieldToBytes32Hex`.
- **Metro buffer alias** — `metro.config.js` resolves `buffer` to the real npm
  package so snarkjs works in Expo web production bundles.
- **`WalletContext.createSeamlessAttestation`** — device-side attestation
  production; wallet secret never leaves the context boundary.

### Changed

- Replaced the sha256 "pairing root" with the real Poseidon identity commitment
  as the authoritative on-chain anchor.
- `Lockb0x.initialize` and `set_attestation` now use `panic_with_error!`
  (typed `Lockb0xError` enum) instead of raw `assert!`.
- Provisioner `deploy.zip` excludes test files (`tsconfig.json` `exclude`).
- `.gitignore` covers `provisioner-logs/`, `provisioner-logs-live/`,
  `packages/contracts/test_snapshots/`.
- `staging-deploy.yml` moves `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and
  `AZURE_SUBSCRIPTION_ID` from plaintext env to `${{ secrets.* }}`.

### Fixed

- Onboarding fail-closed guards: create button disabled until wallet ready;
  session refused if lockb0x or attestation is missing.
- `WalletContext` node-session fast-path no longer reports `verified` when
  `userLockboxContractId` is null.
- `feed.tsx` and `local.tsx` route guards block unauthenticated access.
- ZK artifact blob storage (Azure) missing CORS header — added `*` GET policy.
- `globalThis.Buffer` undefined in Expo web production bundle — fixed via Metro
  `extraNodeModules.buffer` alias + boot-time polyfill.

[0.1.0-testnet]: https://github.com/lockb0x-llc/nodezero-social/releases/tag/v0.1.0-testnet
[0.0.3-testnet]: https://github.com/lockb0x-llc/nodezero-social/compare/ae6efaeadb174eb50ed62001fae2924c0671adf0...7b98755c321795aeca46c5dd8c0c06b5429a8938
[0.0.2]: https://github.com/lockb0x-llc/nodezero-social/releases/tag/v0.0.2
[Unreleased]: https://github.com/lockb0x-llc/nodezero-social/compare/v0.0.2...HEAD
