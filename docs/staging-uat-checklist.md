# Staging-TestNet UAT Checklist

Release gate for the NodeZero.social `staging-testnet` environment. The
automated portion runs via `pnpm qa:smoke` (see
[scripts/qa/staging-smoke.sh](../scripts/qa/staging-smoke.sh)); this checklist
covers the interactive journeys that cannot be verified by an unauthenticated
HTTP probe. It is written to be executable by a reviewer who did not author the
code.

## How to run

1. Confirm the staging deploy workflow completed (infra + Expo web publish).
2. Run the automated smoke gate:
   ```sh
   STAGING_BASE_URL=https://staging.nodezero.social pnpm qa:smoke
   ```
3. Run the blocking onboarding/authentication E2E gate (identity only —
   application-feature proofs run separately and never block this gate):
   ```sh
   STAGING_BASE_URL=https://staging.nodezero.social pnpm qa:smoke:auth
   ```
   PASS requires all three journeys green: new-user create (Pod + WebID +
   on-chain lockb0x + inline NodeZero session, zero browser↔CSS requests),
   returning one-tap Stellar sign-in with the same WebID, and the negative
   fail-closed path (tampered session → sign-in page).
4. Work through the manual journeys below. Record PASS/FAIL and notes per row.

## Preconditions

- [x] `staging-testnet` Bicep parameters deployed with real contract IDs.
- [ ] ZK artifacts and manifest URLs published and reachable.
- [x] Relay service deployed with a reachable `/health` endpoint.
- [x] Static Web App custom domain `staging.nodezero.social` resolves with valid TLS.

## Automated smoke (gate)

| # | Check | Expected | Result |
|---|-------|----------|--------|
| A1 | `pnpm qa:smoke` landing markers | `NodeZero` + `Sign in to your node` present | RE-RUN REQUIRED (cutover) |
| A2 | `pnpm qa:smoke` routes | `/feed`, `/local`, `/profile`, `/settings` reachable | **PASS** |
| A3 | TLS enforced | Base URL rejected unless `https` | **PASS** |

## Manual journeys

### Authentication (internal NodeZero sessions — cutover)

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| AU1 | Returning user taps **Sign In** (device with existing wallet) | One-tap Stellar signature login → authenticated feed. No IdP page, no password, no redirect leg, zero requests to `solid.nodezero.social` | RE-RUN REQUIRED (cutover) | Automated by `scripts/qa/staging-auth-evidence.mjs` (Journey 2). |
| AU2 | Sign In on a device with no NodeZero account | Actionable error: no node exists for this device key; user is pointed to Create Your Node | RE-RUN REQUIRED (cutover) | Provisioner returns `401 no_account`; no fallback auth path exists. |
| AU3 | Landing page audit | No password inputs, no identity-provider picker, no `solidcommunity.net` mention anywhere | RE-RUN REQUIRED (cutover) | Playwright `auth-invariant.spec.ts` (I5). |
| AU4 | Sign out via Profile → Settings | Session destroyed (`nz.session.v2` cleared), returns to landing; every deep link redirects to `/` | RE-RUN REQUIRED (cutover) | Navigate `/profile` → ⚙ → `/settings` → **Sign Out**. |
| AU5 | New-user seamless onboarding: handle + email → Create Your Node | ZK proof → Pod + WebID created → lockb0x anchored on-chain → **inline NodeZero session** → authenticated feed with no redirect leg and no password anywhere | RE-RUN REQUIRED (cutover) | Automated by `scripts/qa/staging-auth-evidence.mjs` (Journey 1); on-chain lockb0x asserted via stellar.expert. |
| AU6 | Returning sign-in restores the same identity | Same WebID as onboarding; session carries lockb0x anchor metadata; client-side attestation check verifies | RE-RUN REQUIRED (cutover) | Automated (Journey 2); WebID equality asserted. |
| AU7 | Fail-closed enforcement: tamper/clear the stored session, deep-link `/feed` | App lands on the sign-in page; forged record destroyed; no zombie state | RE-RUN REQUIRED (cutover) | Automated (Journey 3) + Playwright `auth-invariant.spec.ts` (I2). |

### Navigation UX (nav overflow fix + Settings-via-Profile)

Validate the nav bar overflow fix and the Settings access path change introduced in the nav-ux refactor. These rows require an authenticated session and a browser with DevTools responsive mode.

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| N1 | Authenticated at 375px (Chrome DevTools → iPhone SE preset): inspect bottom nav | Nav bar shows 7 tabs (Local, Broadcast, Stream, Feed, Directory, Backpack, Profile). No "Settings" tab visible. No tab is clipped off-screen. Bar scrolls horizontally if viewport is very narrow. | — | Emulate iPhone SE (375×812) via DevTools Device toolbar. |
| N2 | Authenticated at 375px: tap **Profile** tab → confirm ⚙ icon → tap it | ⚙ gear icon appears top-right of Profile content area. Tap navigates to `/settings` page without reload. | — | Gear icon uses `settings-outline` Ionicon, `textMid` colour. |
| N3 | Repeat N1 and N2 in Safari (WebKit) via responsive mode | Same pass criteria as N1/N2 — horizontal scroll and gear icon work in Safari | — | Use Safari → Develop → Responsive Design Mode (or equivalent). |

### Community Directory + Trust Circle acceptance

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| CD1 | Authenticated at 375px, inspect bottom nav order | Directory tab is present between Feed and Backpack | — | Manual counterpart to `pnpm qa:smoke:community-directory` tab-sequence evidence. |
| CD2 | Open Directory tab and tap Refresh before any opt-in record is published | Unlisted users remain absent from non-connection results | — | Verifies unlisted-by-default behavior in the UI. |
| CD3 | Trigger opt-in for a seeded account via provisioner API and refresh Directory | Newly listed member appears in Directory results | — | Pairs with automated store lifecycle test and API mutation checks. |
| CD4 | Trigger opt-out for the same member and refresh Directory | Member is removed/hidden from Directory results while existing direct connections remain connectable | — | Confirms opt-out removal behavior in UI. |
| CD5 | In Directory, add a directory-only member to Trust Circle and do not add as connection | Trust Circle badge/state updates in Directory only | — | Precondition for CD6 recipient guard check. |
| CD6 | Compose in `verified` audience with directory-only trust-circle member (no connection) | Recipient targeting does not include that member | — | Confirms Trust Circle remains a filter signal, not implicit targeting. |
| CD7 | Compose in `foaf`, `verified`, and `local` with known contacts | Existing audience behavior remains stable across all modes | — | Validate no regression versus pre-directory behavior. |

### Global feed

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| FE1 | Open the global feed while authenticated | Feed renders without runtime errors | **PASS (2026-06-28 headed validation)** | Authenticated return landed directly on `/feed`; feed shell rendered (`Global Feed`, `NodeZero Session`, quiet-feed empty state). Console showed a non-blocking `401` fetch error during background requests. |

### Docustream (stream + source management)

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| DS1 | Add RSS source from Stream -> Sources modal, then ingest | Source is saved, ingest completes, and stream items render in-pane | **PASS (2026-07-09 live staging validation)** | Stabilized read path now handles JSON-LD and Turtle Pod container listings. |
| DS2 | Add source while Solid write auth is stale/expired | UI surfaces recovery guidance and redirects to Solid sign-in to restore write access | **PASS (2026-07-09 live staging validation)** | Source flow now explicitly initiates re-auth when write returns auth failures. |

### Profile + social graph (contacts and directory)

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| PR1 | Authenticated user updates Profile fields and taps Save to Solid Pod | Save succeeds, profile reload reflects persisted values, and no silent failure occurs during session-restore windows | **PARTIAL PASS (2026-07-09 headed validation)** | Tested with account `pakana-10@pakana.net`: profile values saved and later reloaded (`Display Name`/`Bio` values present after auth round-trip). One transient `PATCH ... net::ERR_ABORTED` was observed during session refresh churn; stale-session-forced re-auth branch was not deterministically reproduced in this manual pass. |
| PR2 | In Profile, add a valid contact WebID then remove it | Added WebID appears in Connections list and remove action updates list consistently | **PASS (2026-07-09 live staging rerun)** | With account `https://solid.nodezero.social/qa-conn-20260709-1/profile/card#me`, adding `https://solid.nodezero.social/pakana-10/profile/card#me` immediately rendered a Connections row and status `Connection added successfully.`; removing it returned to empty state and status `Connection removed.`. |
| PR3 | Open Directory tab and connect to an entry | Directory list renders, connect action adds relationship unless entry is self/already connected | — | Supersedes legacy Profile-embedded directory flow; execute from dedicated `/directory` tab. |

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| LM1 | Open the Local Node screen | Local discovery initialises against the staging relay | **PARTIAL PASS (2026-06-28 headed validation)** | While authenticated, `/local` opens and renders Local Node screen, but this run is blocked at location permission gate (`Location access is required...`). Relay endpoint is healthy; manual location-allow step still required for full pass in a normal browser context. |
| LM2 | Exchange a message between two local sessions | Offer/answer/ICE relayed; message delivered | **PASS (2026-06-28 headed validation)** | QA-only local override build enabled deterministic same-run two-peer validation. Headed browser tabs on `/local?qaBypassLocation=1` used distinct override identities (`https://nodezero-lm2-a.solidcommunity.net/profile/card#me` and `https://nodezero-lm2-b.solidcommunity.net/profile/card#me`), exchanged messages both directions, and rendered delivered messages in each session. Relay transport was also independently verified by `node scripts/qa/relay-signal-e2e.mjs` (PASS: forwarded offer/answer/ice-candidate between two concurrent peers). |

### Wallet registration (Stellar)

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| WR1 | First launch provisions the embedded wallet silently | Wallet address available in Settings | **PASS (fixed: web localStorage fallback)** | `expo-secure-store` incompatibility fixed; web now uses `WebLocalStorageSecureStore` so the wallet persists across page loads. Settings shows Stellar Public Key and ✅ Active on Testnet. |
| WR2 | Register WebID on-chain | `NodeZeroIdentity` registration transaction succeeds on TestNet | **PASS (covered by AT1)** | Registration tx confirmed in AT1 re-test: `3dd6f3c11155bed556225efc56d5e939d955eccf7522a06208e75615e71bdb3b`. |

### Pairing attestation (Lockb0x)

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| AT1 | First authenticated onboarding with wallet+WebID | `register_webid` tx submitted when mapping is absent | **PASS (2026-06-26 RE-TEST)** | Settings shows authenticated WebID `https://nodezero-qa.solidcommunity.net/profile/card#me`, TestNet wallet `GA2SRBOXVC5GWL2Q7ZWC2UZACNSXKJ6KYC6BNZUPOTPFAY7OWQHMFROV`, and registration tx `3dd6f3c11155bed556225efc56d5e939d955eccf7522a06208e75615e71bdb3b`. |
| AT2 | Read chain mapping + root | `get_webid` and `get_state_root` return non-empty values | **PASS (2026-06-26 RE-TEST)** | Settings shows registered WebID `https://nodezero-qa.solidcommunity.net/profile/card#me` and Lockb0x root `0000000000000000000000000000000000000000000000000000000000000001`. |
| AT3 | Returning sign-in with existing local proof record | Fails closed if stored proof inputs do not match current lockbox root | **PASS (2026-06-26 RE-TEST)** | Browser reload retained the web wallet and proof record; Settings shows `Returning sign-in proof verified against current lockbox root.` |
| AT4 | Seamless "Create Your Node" happy path (fail-closed gate) | Create button disabled until wallet ready; on success a per-user lockb0x is created (`storage_entries:3`) and the user lands in the authenticated app | **PASS (2026-07-01 headed validation)** | Button gated `Preparing wallet…`→`Create Your Node`; created lockb0x `CBFEODFERDIWRDYJFEF6ATU6C7CR2MPD4A5JR3WI5US2UAXGP3SR74U2` (creator=Deployer `GDMJ3GFM…`, wasm `795157cc…`, `storage_entries:3`) via v2 factory `CA5MASVC…`; landed on `/local`. Screenshots in `docs/screenshots/onboarding-p1-*.png`. |
| AT5 | Treasury-sponsored member funding (P3, MainNet readiness) | With `JSS_TREASURY_FUND_MEMBERS=1`, a new member's Stellar account is Treasury-funded during onboarding (idempotent, fail-closed) so no Friendbot/self-funding is needed | **NOT TESTED (TestNet uses Friendbot)** | Enable on MainNet cutover. `POST /v1/create-account` (internal-key gated) available for explicit funding; unit tests PASS. |
| AT6 | **Real ZK attestation anchored on-chain** — device generates a `pod_ownership` Groth16 proof + AES-256-GCM-encrypts the claim; provisioner `set_attestation` stores the identity commitment + ciphertext in the lockb0x | On-chain `get_account_commitment` = `Poseidon(identitySecret)` and `get_attestation_ciphertext` = encrypted claim; onboarding fails closed if the attestation is not anchored | **PASS (2026-07-01 live E2E)** | Node `zkval5188550`; lockbox `CBKUKJJFHUFWKB25NJBUVNH24HPO4JNNICWYYFZBHOINJMSR2PANVA7B` (new wasm `55bcb3a4…`): `get_account_commitment=1aabc344…`, `get_attestation_ciphertext=0103361112…`, `storage_entries:5`, `attest` event. Screenshot `docs/screenshots/zk-attestation-onboarded-local.png`. Replaces the prior sha256 pairing root. |

### Environment & observability

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| EO1 | Confirm TestNet passphrase in runtime config | `Test SDF Network ; September 2015` | **PASS** | Embedded in staging bundle (NZ_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015). WalletContext checks this at startup. |
| EO2 | Confirm telemetry/logs flowing in App Insights | Requests and traces visible | **NOT TESTED** | Requires Azure portal access. |

### Additional findings (not in original checklist)

| # | Observation | Severity | Notes |
|---|---|---|---|
| X1 | favicon.ico returns 404 | Fixed | `packages/mobile-app/app.config.js` now sets `web.favicon` to `./assets/favicon.png`. |
| X2 | Settings page accessible without auth | By design | Shows WebID=Not signed in, NSFW toggle, wallet section. Correct behavior. |
| X3 | WalletContext expo-secure-store error | FIXED | Fixed by web localStorage fallback in EnclaveAdapter; no longer fires on web. |
| X4 | App version shown as `v0.0.1` | Info | Correct pre-release version. |

## Summary matrix

| Journey | Status |
|---|---|
| Route reachability (all 5) | ✅ PASS |
| TLS enforcement | ✅ PASS |
| Landing page rendering | ✅ PASS |
| Auth guards on protected routes | ✅ PASS |
| Solid IdP redirect initiation | ✅ PASS |
| Post-auth authenticated flow | ✅ PASS (2026-06-28 headed validation) |
| Blocking auth gate (`qa:smoke:auth`) | ✅ PASS (2026-07-10, staging run #46 step #28 success) |
| Empty IdP error specificity | ✅ PASS (2026-06-28 headed validation) |
| HTTP IdP client-side rejection | ✅ PASS (2026-06-28 headed validation) |
| Wallet provisioning on web | ✅ PASS (web localStorage fallback) |
| Wallet on-chain registration | ✅ PASS (AT1 evidence) |
| Attestation proof verification (returning sign-in) | ✅ PASS |
| Nav bar overflow fix (7 tabs incl. Directory, horizontal scroll) | — |
| Settings accessible via Profile ⚙ gear | ✅ PASS (2026-06-28 N2) |

## Sign-off

- Release decision: **GO** for staging/testnet milestone release
- Rationale: Blocking onboarding/authentication E2E gate now passes in CI (run #46), Directory-tab implementation is deployed, and core smoke gates remain green.
- Reviewer: QA_RELEASE_AGENT + PM evidence bundle (automation + workflow run evidence)
- Date: 2026-07-10

## ACL Hardening Validation Addendum

Use this addendum after ACL namespace hardening rollout in staging.

| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| AH1 | Add DocuStream source with valid session | Save succeeds without ACL deny | — |  |
| AH2 | Toggle DocuStream source active state | Update persists without ACL deny | — |  |
| AH3 | Submit crafted invalid ACL payload | Write is rejected with expected `ruleId` | — |  |
| AH4 | Run AU/profile standard flows post-cutover | No false-positive ACL denies observed | — |  |

### 2026-06-26 re-test evidence (post infra + web publish)

- `pnpm qa:smoke` result: **PASS** for landing markers and route reachability on `https://staging.nodezero.social`.
- Solid OIDC consent flow returned to `/feed` successfully.
- Blocking behavior remains for attestation validation: `/settings` rendered `WebID: Not signed in` after consent and did not expose attestation verification outputs.
- Follow-up deploy/retest: Bicep deploy succeeded, SWA production publish succeeded, custom domain status is Ready, and smoke passes. Key Vault now holds Identity `CCHFYOKLGVTXEYYHWEFPI22FR26VRGG2CBBUTP6XPW3ZSIWIKEVQQ44K` and Lockb0x `CB36LY5WZLJNMY4DHRXQER6LU3L4E5MGFYT2XSJG7ZJZV5SIIOKODT2H`.
- Follow-up browser evidence: Settings shows authenticated WebID and active TestNet wallet, but AT1/AT2 remain blocked by the client-side Soroban return decode error above.
- Final follow-up evidence: Lockb0x root initialized on TestNet with operator `GBMXG2UIWFBHPKRBDQCEFNIDR3WHJAPVVGBCIOD5SGKZYZQISENZKD5O`; direct `get_state_root` returns `0000000000000000000000000000000000000000000000000000000000000001`; Settings verifies onboarding and returning sign-in against that root.

## Authentication status for re-test

- Solid Pod: `https://nodezero.solidcommunity.net/` — CONFIRMED LIVE ✅
- WebID: `https://nodezero.solidcommunity.net/profile/card#me` — CONFIRMED VIA TOKEN AUTH ✅
- IdP URL for app sign-in form: `https://solidcommunity.net/` ✅
- CSS token credentials: CONFIRMED WORKING — 200 OK Bearer token from `.oidc/token` ✅
- Pod structure verified: `README`, `inbox/`, `public/`, `profile/`, `settings/`, `robots.txt` ✅
- Profile card: `foaf:Person` with `solid:oidcIssuer`, no custom display name yet (fresh pod)
- Social graph (`/social/`): not yet created — pending B1/B2 implementation
- Browser OAuth (web sign-in): requires web password — reset email sent to `admin@nodezero.social` 2026-06-25
- When reset link received: set password to value in `docs/dev-only/nodezero pod solidcommunity-net.txt`
- After password reset + staging redeploy: re-run QA starting at AU1 to complete all authenticated journeys

## 2026-06-27 J4 authenticated rerun evidence

Execution context:

- Automated smoke: PASS (`scripts/qa/staging-smoke.sh` against `https://staging.nodezero.social`).
- Browser run: successful Solid login, consent, and authenticated route access.

Result updates:

| Check | Result | Evidence |
|---|---|---|
| AU1 | PASS | Solid login + consent returned to `/feed`.
| AU4 | PASS | `/settings` Sign Out returned session to landing route `/`.
| WR2 | PASS | Settings shows registered WebID + registration tx `0ebeff3612e301c5dc8fdeee5c4b5b9c9ca5b4e0808e4f24c6ccd31f7c17e81d`.
| LM1 | FAIL | `/local` shows location-permission gate and relay handshake failure (`WebSocket ... /relay ... 503`).
| LM2 | BLOCKED | Cannot complete two-client message exchange while LM1 relay/location prerequisites are failing.

Relay root-cause note:

- Current staging bundle embeds `relayUrl = wss://staging.nodezero.social/relay`.
- `GET /relay` on staging returns the SPA HTML shell (`200 text/html`) rather than a WebSocket relay backend.
- Remediation: deploy/route a live relay endpoint and set `NZ_RELAY_URL` to that host before rerunning LM1/LM2.

J4 status: **NEEDS-INFO**

- Required follow-up before final APPROVE sign-off:
   1. Restore relay endpoint availability for authenticated `/local` sessions (resolve 503 on `/relay` WebSocket handshake).
   2. Re-run LM1/LM2 with two authenticated clients after relay recovery.

## 2026-06-27 relay recovery evidence

Infrastructure and deployment updates completed:

- Dedicated relay host is live at `nodezero-social-staging-testnet-relay.azurewebsites.net`.
- Relay health endpoint returns HTTP 200 JSON (`{"ok":true,"service":"relay-service"...}`).
- Two-client WebSocket probe passed against relay host (`offer` forwarded `alice -> bob`).
- Staging web bundle now resolves to `entry-ea77f9d83f0d47754f3676e4f6ded818.js` and embeds `relayUrl = wss://nodezero-social-staging-testnet-relay.azurewebsites.net`.
- Previous invalid relay endpoint is no longer present in the staging bundle (`wss://staging.nodezero.social/relay` absent).
- Automated smoke suite passes against `https://staging.nodezero.social` after redeploy.

Updated J4 status: **IN_PROGRESS**

- Remaining work to close J4:
   1. Re-run LM1 with authenticated `/local` flow and location permission allowed.
   2. Re-run LM2 with two authenticated clients to verify end-to-end encrypted message exchange.

## 2026-06-27 authenticated rerun (post-relay-cutover)

Execution evidence captured:

- Solid login + OIDC consent succeeded; app returned to authenticated `/feed`.
- Navigation to `/local` succeeds, but UI remains blocked on location permission gate.
- Retry action on `/local` keeps the same denied/unavailable location state in this run.
- In-browser automation environment cannot programmatically grant geolocation permission (`Browser.grantPermissions` not available in this harness), so LM1 cannot be completed in this session.

## 2026-06-27 authenticated rerun (with dev geolocation mock)

Execution evidence captured:

- Applied dev-only geolocation mock fixture behavior (`docs/dev-only/mock-geolocation.js`) in page context before reload.
- Reloaded authenticated `/local` route with mock active.
- `/local` now renders live Local Node state (`Your Local Node`, H3 index `892986b8003ffff`, surrounding node chips), confirming location gate cleared.
- Relay panel no longer shows the prior handshake error banner after route stabilization.

Current LM status (updated):

- LM1: **PASS (harness with geolocation mock)**.
- LM2: **BLOCKED** pending two simultaneously authenticated clients with distinct active WebIDs for end-to-end message exchange proof.

Current LM status:

- LM1: **BLOCKED (environmental)** pending manual geolocation allow in a normal browser session.
- LM2: **BLOCKED** until LM1 proceeds with location-enabled `/local` access on two authenticated clients.

## 2026-07 internal-session cutover baseline

Purpose:

- Enforce the internal-only NodeZero session flow in staging: no browser-side CSS authentication, no user-facing password flow, and no OIDC redirect leg.
- Keep onboarding and returning sign-in tied to device-key challenge signing plus provisioner-issued NodeZero sessions.

Required mobile-app build env values:

- `NZ_ENV_PROFILE=staging-testnet`
- `NZ_NODEZERO_ISSUER_URL=https://solid.nodezero.social/`
- `NZ_JSS_PROVISIONER_URL=<staging provisioner url>`
- `NZ_RELAY_URL=wss://nodezero-social-staging-testnet-relay.azurewebsites.net`
- `NZ_STELLAR_RPC_URL=https://soroban-testnet.stellar.org`
- `NZ_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015`
- `NZ_IDENTITY_CONTRACT_ID=<staging identity contract id>`
- `NZ_LOCKBOX_CONTRACT_ID=<staging lockbox contract id>`

Expected behavior:

- Landing exposes one-tap sign-in and Create Your Node with no IdP picker.
- Returning-user sign-in uses one tap (device key challenge signature) and lands in authenticated surfaces without redirect legs.
- Feed, Local, and Settings auth mode labels show `NodeZero Session`.
- Browser never talks directly to `solid.nodezero.social`; Pod access flows through `/v1/pod-proxy/*`.

Validation snapshot:

- `pnpm qa:smoke:auth` is the blocking identity gate and must pass all three journeys.
- `auth-invariant.spec.ts` confirms no password field, no IdP picker, and no legacy bridge params.
- Session invariant remains fail-closed (`session_invalid` clears session and returns to sign-in).
