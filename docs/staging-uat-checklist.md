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
3. Work through the manual journeys below. Record PASS/FAIL and notes per row.

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
| AU1 | Sign in with a valid Solid IdP (`https://solidcommunity.net`) | Redirects to IdP, returns authenticated, lands on feed | **PARTIAL PASS** | Redirect to solidcommunity.net confirmed. Post-auth return not yet tested — requires interactive sign-in with live credentials. |
| AU2 | Submit an empty IdP URL | Actionable error: a provider URL is required | **PARTIAL FAIL** | Shows generic "Login failed. Please check the Identity Provider URL and try again." — not specific. **GAP: error message must distinguish empty URL from network failure.** |
| AU3 | Submit an `http://` non-localhost IdP | Actionable error: provider must use https | **FAIL** | Same generic error as AU2. No specific HTTPS requirement mentioned. **GAP: missing client-side https:// validation before attempting login.** |
| AU4 | Sign out from Settings | Session cleared, returns to landing | **NOT TESTED** | Requires authenticated session. |

### Global feed

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| FE1 | Open the global feed while authenticated | Feed renders without runtime errors | **NOT TESTED** | Requires auth. Auth guard functions correctly (shows "Please sign in to view your feed."). |

### Local messaging (P2P relay)

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| LM1 | Open the Local Node screen | Local discovery initialises against the staging relay | **NOT TESTED** | Auth guard confirmed functional ("Sign in to join your Local Node."). |
| LM2 | Exchange a message between two local sessions | Offer/answer/ICE relayed; message delivered | **NOT TESTED** | Requires two authenticated sessions. |

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
| Post-auth authenticated flow | ⏸ NOT TESTED |
| Empty IdP error specificity | ⚠️ PARTIAL FAIL |
| HTTP IdP client-side rejection | ❌ FAIL |
| Wallet provisioning on web | ✅ PASS (web localStorage fallback) |
| Wallet on-chain registration | ✅ PASS (AT1 evidence) |
| Attestation proof verification (returning sign-in) | ✅ PASS |

## Sign-off

- Release decision: **CONDITIONAL GO** for Milestone K attestation scope
- Rationale: All Milestone K objectives (K1–K5) are DONE. WR1/WR2 wallet provisioning fixed and confirmed on staging. AT1/AT2/AT3 attestation flow PASS. Remaining release work is focused on authenticated LM1/LM2/AU4 rerun and ongoing platform hardening (D1/D3).
- Reviewer: QA_RELEASE_AGENT + PM direct evidence (automated browser session, 2026-06-26)
- Date: 2026-06-26

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
