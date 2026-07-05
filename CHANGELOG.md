# Changelog

All notable changes to NodeZero Social are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

- No entries yet.

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
[0.0.2]: https://github.com/lockb0x-llc/nodezero-social/releases/tag/v0.0.2
[Unreleased]: https://github.com/lockb0x-llc/nodezero-social/compare/v0.0.2...HEAD
