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
| WR1 | First launch provisions the embedded wallet silently | Wallet address available in Settings | **FAIL — P1 BUG** | `TypeError: n.default.getValueWithKeyAsync is not a function` on every page load. `expo-secure-store` native module method not available in web/SPA context. Settings shows "Provisioning…" forever. **Root cause: expo-secure-store web shim not wired correctly in Metro/Expo web export.** |
| WR2 | Register WebID on-chain | `NodeZeroIdentity` registration transaction succeeds on TestNet | **BLOCKED** | Blocked by WR1 failure. |

### Pairing attestation (Lockb0x)

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| AT1 | First authenticated onboarding with wallet+WebID | `register_webid` tx submitted when mapping is absent | **PENDING RE-TEST** | Runtime now attempts registration only on onboarding path. |
| AT2 | Read chain mapping + root | `get_webid` and `get_state_root` return non-empty values | **PENDING RE-TEST** | Added client reads via embedded wallet service. |
| AT3 | Returning sign-in with existing local proof record | Fails closed if stored proof inputs do not match current lockbox root | **PENDING RE-TEST** | New strict verification path compares stored proof record to current chain root and mapping. |

### Environment & observability

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| EO1 | Confirm TestNet passphrase in runtime config | `Test SDF Network ; September 2015` | **NOT TESTED** | WalletContext.tsx has correct passphrase in code; runtime verification blocked by WR1. |
| EO2 | Confirm telemetry/logs flowing in App Insights | Requests and traces visible | **NOT TESTED** | Requires Azure portal access. |

### Additional findings (not in original checklist)

| # | Observation | Severity | Notes |
|---|---|---|---|
| X1 | favicon.ico returns 404 | Minor | Missing favicon in Expo web export. No functional impact. |
| X2 | Settings page accessible without auth | By design | Shows WebID=Not signed in, NSFW toggle, wallet section. Correct behavior. |
| X3 | WalletContext error fires on EVERY page | P1 | Same `expo-secure-store` error on /, /feed, /local, /profile, /settings because WalletContext is in the root layout. |
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
| Wallet provisioning on web | ❌ FAIL (P1) |
| Wallet on-chain registration | ⏸ BLOCKED |
| Attestation proof verification (returning sign-in) | ⏸ PENDING RE-TEST |

## Sign-off

- Release decision: **BLOCK**
- Rationale: P1 bug WR1 (wallet provisioning fails on web due to `expo-secure-store` incompatibility) — FIXED in testnet branch commit 778c37f, pending staging redeploy. Auth error messages AU2/AU3 — FIXED in same commit. Authenticated journeys (FE1, LM1, LM2, WR2, AU4) not yet executed — pending password reset for admin@nodezero.social and staging redeploy.
- Reviewer: QA_RELEASE_AGENT (automated browser session, 2026-06-25)
- Date: 2026-06-25

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
