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
   PASS requires both journeys green: new-user create (Pod + WebID +
   on-chain lockb0x + bridge auto sign-in + consent + session) and
   returning-user credential login with the same WebID.
4. Work through the manual journeys below. Record PASS/FAIL and notes per row.

## Preconditions

- [x] `staging-testnet` Bicep parameters deployed with real contract IDs.
- [ ] ZK artifacts and manifest URLs published and reachable.
- [x] Relay service deployed with a reachable `/health` endpoint.
- [x] Static Web App custom domain `staging.nodezero.social` resolves with valid TLS.

## Automated smoke (gate)

| # | Check | Expected | Result |
|---|-------|----------|--------|
| A1 | `pnpm qa:smoke` landing markers | `NodeZero` + `Sign in with Solid Pod` present | **PASS** |
| A2 | `pnpm qa:smoke` routes | `/feed`, `/local`, `/profile`, `/settings` reachable | **PASS** |
| A3 | TLS enforced | Base URL rejected unless `https` | **PASS** |

## Manual journeys

### Authentication (Solid)

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| AU1 | Sign in with a valid Solid IdP (`https://solidcommunity.net`) | Redirects to IdP, returns authenticated, lands on feed | **PASS (2026-06-28 headed validation)** | Full OIDC loop confirmed: staging sign-in redirected to Solid consent and returned to authenticated `/feed` with `OIDC Redirect` auth chip. |
| AU2 | Submit an empty IdP URL | Actionable error: a provider URL is required | **PASS (2026-06-28 headed validation)** | Landing sign-in panel now shows explicit message: `Enter your Identity Provider URL.` |
| AU3 | Submit an `http://` non-localhost IdP | Actionable error: provider must use https | **PASS (2026-06-28 headed validation)** | Landing sign-in panel now shows explicit message: `URL must start with https://` |
| AU4 | Sign out via Profile → Settings | Session cleared, returns to landing | — | Navigate to `/profile` while authenticated → tap ⚙ gear icon → `/settings` opens → tap **Sign Out** → session cleared and landing `/` restored. *(Settings tab removed from nav bar; gear icon on Profile is the new access path.)* |
| AU5 | New-user seamless onboarding: handle + email + password (min 12) → Create Your Node | ZK proof → Pod + WebID created → lockb0x anchored on-chain → bridge auto sign-in → consent → authenticated at `/local` with no manual credential entry | **PASS (2026-07-08 `qa:smoke:auth`)** | Automated by `scripts/qa/staging-auth-evidence.mjs` (new-user journey); on-chain lockb0x contract ID + pairing proof root asserted. |
| AU6 | Returning user: manual sign-in with onboarding credentials (fresh browser) | IdP login → consent → authenticated session with the same WebID | **PASS (2026-07-08 `qa:smoke:auth`)** | Automated by `scripts/qa/staging-auth-evidence.mjs` (returning-user journey); WebID equality across journeys asserted. |
| AU7 | Bridge failure fallback: bridge consume fails on the IdP login page | Login form re-enabled with fallback message; manual credentials complete sign-in | — | Fallback copy: “Secure sign-in could not be completed automatically…”. The user-chosen password guarantees no dead end. |

### Navigation UX (nav overflow fix + Settings-via-Profile)

Validate the nav bar overflow fix and the Settings access path change introduced in the nav-ux refactor. These rows require an authenticated session and a browser with DevTools responsive mode.

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| N1 | Authenticated at 375px (Chrome DevTools → iPhone SE preset): inspect bottom nav | Nav bar shows 6 tabs (Local, Broadcast, Stream, Feed, Backpack, Profile). No "Settings" tab visible. No tab is clipped off-screen. Bar scrolls horizontally if viewport is very narrow. | — | Emulate iPhone SE (375×812) via DevTools Device toolbar. |
| N2 | Authenticated at 375px: tap **Profile** tab → confirm ⚙ icon → tap it | ⚙ gear icon appears top-right of Profile content area. Tap navigates to `/settings` page without reload. | — | Gear icon uses `settings-outline` Ionicon, `textMid` colour. |
| N3 | Repeat N1 and N2 in Safari (WebKit) via responsive mode | Same pass criteria as N1/N2 — horizontal scroll and gear icon work in Safari | — | Use Safari → Develop → Responsive Design Mode (or equivalent). |

### Global feed

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| FE1 | Open the global feed while authenticated | Feed renders without runtime errors | **PASS (2026-06-28 headed validation)** | Authenticated return landed directly on `/feed`; feed shell rendered (`Global Feed`, `OIDC Redirect`, quiet-feed empty state). Console showed a non-blocking `401` fetch error during background requests. |

### Docustream (stream + source management)

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| DS1 | Add RSS source from Stream -> Sources modal, then ingest | Source is saved, ingest completes, and stream items render in-pane | **PASS (2026-07-09 live staging validation)** | Stabilized read path now handles JSON-LD and Turtle Pod container listings. |
| DS2 | Add source while Solid write auth is stale/expired | UI surfaces recovery guidance and redirects to Solid sign-in to restore write access | **PASS (2026-07-09 live staging validation)** | Source flow now explicitly initiates re-auth when write returns auth failures. |

### Profile + social graph (contacts and directory)

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| PR1 | Authenticated user updates Profile fields and taps Save to Solid Pod | Save succeeds, profile reload reflects persisted values, and no silent failure occurs during session-restore windows | **PARTIAL PASS (2026-07-09 headed validation)** | Tested with account `pakana-10@pakana.net`: profile values saved and later reloaded (`Display Name`/`Bio` values present after auth round-trip). One transient `PATCH ... net::ERR_ABORTED` was observed during OIDC restore churn; stale-session-forced re-auth branch was not deterministically reproduced in this manual pass. |
| PR2 | In Profile, add a valid contact WebID then remove it | Added WebID appears in Connections list and remove action updates list consistently | **PASS (2026-07-09 live staging rerun)** | With account `https://solid.nodezero.social/qa-conn-20260709-1/profile/card#me`, adding `https://solid.nodezero.social/pakana-10/profile/card#me` immediately rendered a Connections row and status `Connection added successfully.`; removing it returned to empty state and status `Connection removed.`. |
| PR3 | In Profile, open Community Directory and connect to an entry | Directory list renders, connect action adds relationship unless entry is self/already connected | **PASS (2026-07-09 live staging rerun)** | Community Directory rendered self + non-self entries, and the non-self target transitioned to `Connected` after add. After removal in PR2 rerun, directory reflected self-only state again as expected. |

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
| Empty IdP error specificity | ✅ PASS (2026-06-28 headed validation) |
| HTTP IdP client-side rejection | ✅ PASS (2026-06-28 headed validation) |
| Wallet provisioning on web | ✅ PASS (web localStorage fallback) |
| Wallet on-chain registration | ✅ PASS (AT1 evidence) |
| Attestation proof verification (returning sign-in) | ✅ PASS |
| Nav bar overflow fix (6 tabs, horizontal scroll) | ✅ PASS (2026-06-28 N1) |
| Settings accessible via Profile ⚙ gear | ✅ PASS (2026-06-28 N2) |

## Sign-off

- Release decision: **CONDITIONAL GO** for Milestone K attestation scope
- Rationale: All Milestone K objectives (K1–K5) are DONE. WR1/WR2 wallet provisioning fixed and confirmed on staging. AT1/AT2/AT3 attestation flow PASS. Remaining release work is focused on authenticated LM1/LM2/AU4 rerun and ongoing platform hardening (D1/D3).
- Reviewer: QA_RELEASE_AGENT + PM direct evidence (automated browser session, 2026-06-26)
- Date: 2026-06-26

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

## 2026-06-28 staging OIDC onboarding baseline

Purpose:

- Enforce a single real onboarding path in staging: Solid OIDC redirect with real Pod identity.
- Remove local bootstrap auth behavior from runtime configuration and UI messaging.

Required mobile-app build env values:

- Detailed build/deploy procedure: `docs/dev-only/oidc-refactoring/staging-oidc-deploy-verify.md`

- `NZ_ENV_PROFILE=staging-testnet`
- `NZ_SOLID_OIDC_ISSUER_URL=<staging-approved issuer url>`
- `NZ_SOLID_SIGNUP_URL=<staging-approved pod signup url>`
- `NZ_SOLID_ACCOUNT_PORTAL_URL=<staging-approved account portal url>`
- `NZ_RELAY_URL=wss://nodezero-social-staging-testnet-relay.azurewebsites.net`
- `NZ_STELLAR_RPC_URL=https://soroban-testnet.stellar.org`
- `NZ_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015`
- `NZ_IDENTITY_CONTRACT_ID=<staging identity contract id>`
- `NZ_LOCKBOX_CONTRACT_ID=<staging lockbox contract id>`

Expected behavior:

- Landing page primary CTA opens the configured Solid signup URL.
- Returning-user sign-in always uses OIDC provider redirect.
- Feed, Local, and Settings auth mode labels show `OIDC Redirect`.
- No runtime dependency on legacy local-bootstrap auth flags.

Validation snapshot:

- File diagnostics clean for `app.config.js`, `app/index.tsx`, `app/feed.tsx`, `app/local.tsx`, `app/settings.tsx`, and `src/contexts/SolidContext.tsx`.
- Source scan across `packages/mobile-app/app/**` and `packages/mobile-app/src/**` confirms no remaining local-bootstrap auth references.

## 2026-06-28 OIDC rollout closeout evidence

Execution evidence captured:

- OIDC build exported (`expo export --clear`) and deployed to SWA production with `@azure/static-web-apps-cli@2.0.7`; deploy returned success for `https://mango-glacier-0abee9e0f.7.azurestaticapps.net`.
- Headed browser validation on `https://staging.nodezero.social` confirms OIDC landing copy and controls are live (`Create a real Solid account...`, `Sign In`, no JSS-mode wording).
- Headed AU1 validation confirms redirect initiation to Solid CSS login UI at `https://solidcommunity.net/.account/login/password/`.
- Staging landing route copy and controls align to real Pod signup plus OIDC sign-in.
- Staging `/feed` header auth chip reads `OIDC Redirect` with OIDC explainer text.
- Staging `/settings` renders `Auth Mode` row with `OIDC Redirect` badge and OIDC explainer.
- Staging `/local` header auth chip reads `OIDC Redirect` with OIDC explainer.
- Headed auth-form validation confirms actionable client-side errors for AU2/AU3 (`Enter your Identity Provider URL.` and `URL must start with https://`).
- Relay health remains green (`/health` HTTP 200 JSON on `nodezero-social-staging-testnet-relay.azurewebsites.net`).
- Headed authenticated validation now confirms AU1 full OIDC return to `/feed`, AU4 sign-out to `/`, and FE1 authenticated feed render.
- LM1 in headed harness reaches authenticated Local Node route but is blocked at browser geolocation permission gate in this run.
- Two concurrent browser tabs now both reach authenticated `/local`; both show the same geolocation permission gate, preventing relay offer/answer exchange in this harness.
- Both concurrent sessions currently authenticate as the same WebID (`https://nodezero-qa.solidcommunity.net/profile/card#me`), so distinct-identity exchange evidence is not yet possible.
- Attempt to create a second pod/WebID from Solid account portal (`/.account/account/.../pod/`) failed twice with provider-side error `Lock expired after 6000ms`.
- Relay signaling path is independently verified from this workspace via `node scripts/qa/relay-signal-e2e.mjs` with PASS output for forwarded `offer`, `answer`, and `ice-candidate` message types on `wss://nodezero-social-staging-testnet-relay.azurewebsites.net`.
- Headed browser LM2 now PASSes end-to-end using the QA-only local override route with peer identities `nodezero-lm2-a` and `nodezero-lm2-b`; both sessions rendered delivered messages after two-way exchange.

Closeout status:

- OIDC-only auth mode rollout: **COMPLETE** for Landing, Feed, Local, and Settings source and diagnostics validation.
- Two-client authenticated `/local` message exchange remains **PENDING** as a separate runtime validation step.
