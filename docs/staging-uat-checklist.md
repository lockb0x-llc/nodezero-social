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

- [ ] `staging-testnet` Bicep parameters deployed with real contract IDs.
- [ ] ZK artifacts and manifest URLs published and reachable.
- [ ] Relay service deployed with a reachable `/health` endpoint.
- [ ] Static Web App custom domain `staging.nodezero.social` resolves with valid TLS.

## Automated smoke (gate)

| # | Check | Expected | Result |
|---|-------|----------|--------|
| A1 | `pnpm qa:smoke` landing markers | `NodeZero` + `Sign in with Solid Pod` present | |
| A2 | `pnpm qa:smoke` routes | `/feed`, `/local`, `/profile`, `/settings` reachable | |
| A3 | TLS enforced | Base URL rejected unless `https` | |

## Manual journeys

### Authentication (Solid)

| # | Step | Expected | Result |
|---|------|----------|--------|
| AU1 | Sign in with a valid Solid IdP (e.g. `https://solidcommunity.net`) | Redirects to IdP, returns authenticated, lands on feed | |
| AU2 | Submit an empty IdP URL | Actionable error: a provider URL is required | |
| AU3 | Submit an `http://` non-localhost IdP | Actionable error: provider must use https | |
| AU4 | Sign out from Settings | Session cleared, returns to landing | |

### Global feed

| # | Step | Expected | Result |
|---|------|----------|--------|
| FE1 | Open the global feed while authenticated | Feed renders without runtime errors | |

### Local messaging (P2P relay)

| # | Step | Expected | Result |
|---|------|----------|--------|
| LM1 | Open the Local Node screen | Local discovery initialises against the staging relay | |
| LM2 | Exchange a message between two local sessions | Offer/answer/ICE relayed; message delivered | |

### Wallet registration (Stellar)

| # | Step | Expected | Result |
|---|------|----------|--------|
| WR1 | First launch provisions the embedded wallet silently | Wallet address available in Settings | |
| WR2 | Register WebID on-chain | `NodeZeroIdentity` registration transaction succeeds on TestNet | |

### Environment & observability

| # | Step | Expected | Result |
|---|------|----------|--------|
| EO1 | Confirm TestNet passphrase in runtime config | `Test SDF Network ; September 2015` | |
| EO2 | Confirm telemetry/logs flowing in App Insights | Requests and traces visible | |

## Sign-off

- Release decision: **APPROVE / BLOCK**
- Rationale:
- Reviewer:
- Date:
