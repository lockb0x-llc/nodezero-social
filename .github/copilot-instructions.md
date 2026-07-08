# NodeZero Workspace Instructions

You are working in the NodeZero Social monorepo.

## Product mission
NodeZero is a decentralized social platform that combines:
- Solid Pods for user-owned profile and social graph data.
- Stellar Soroban smart contracts for identity anchoring and lockbox state.
- ZK artifact/circuit tooling for Proof-of-Humanity style flows.
- Expo web/mobile UI as the product surface.
- Azure as the staging hosting and observability platform.

Treat all implementation and review work as part of this integrated system.

## Repository architecture
Primary packages and responsibilities:
- `packages/mobile-app`: Expo Router app and user journeys.
- `packages/solid-pod-sync`: Solid profile and content sync.
- `packages/p2p-comms`: local peer messaging and signaling protocol.
- `packages/relay-service`: signaling relay backend (WebSocket).
- `packages/embedded-wallet`: Stellar wallet and contract interaction wrapper.
- `packages/contracts`: Rust Soroban contracts.
- `packages/zk-crypto`: circom circuits and artifact build outputs.
- `packages/geo-discovery`: H3-based local discovery utilities.
- `infrastructure/azure`: Azure Bicep templates.

## Mandatory policy constraints
Preserve environment isolation at all times:
- Allowed profiles: `local`, `staging-testnet`, `production-mainnet`.
- Never mix testnet values with mainnet values.
- Staging deploy target is `staging.nodezero.social`.
- Production mainnet deployment is not allowed from staging scripts.
- Do not deploy with `infrastructure/azure/main.parameters.example.json`.

## Identity provider policy
- NodeZero operates its own hosted Solid server: the **Node Zero Community Server** at `https://solid.nodezero.social/` (Community Solid Server on Azure Container Apps, `infrastructure/azure/solid-server.bicep`).
- The Node Zero Community Server is the **default identity provider** in every sign-in and signup surface. `solidcommunity.net` is only a secondary option for users with an external Solid Pod — never the default.
- `NZ_NODEZERO_ISSUER_URL` drives this. `app.config.js` defaults it to the hosted staging Community Server for local/staging; strict profiles fail the build if it is missing.
- Web bundles MUST be built with `NZ_ENV_PROFILE=staging-testnet` (or production) and the full variable set — a bundle built under the `local` profile silently drops the Community Server from the sign-in options. The staging workflow's "Build Expo web artifact" step is the reference variable set.

## Authentication flow contract (separation of concerns)
Onboarding/authentication is a standalone concern, separate from application
features (feed, docustream, backpack, etc.). Application features consume an
authenticated session; they never participate in establishing one.

- Onboarding requires a **user-chosen password** (min 12 chars). The
  provisioner `POST /v1/solid-account` rejects missing/short passwords; never
  reintroduce server-generated credentials the user does not know.
- The OIDC bridge auto sign-in uses an **explicit handoff leg**: app → IdP
  login page with `nz_oidc_bridge` + `nz_oidc_bridge_consume` + validated
  `nz_return` as top-level query params → template consumes ticket and logs in
  via the CSS **account API** (never native `form.submit()`, which is
  DOM-clobbered) → back to app → automatic OIDC resume (`nz_bridge_return=1`).
  Bridge params buried inside the OIDC `redirect_uri` are NOT discoverable by
  the login page — do not regress to that design.
- Every bridge failure must leave the login form usable for manual
  credentials (fallback path). See `docs/architecture.md` → "Authentication
  and session handoff" for the full flow.
- `pnpm qa:smoke:auth` (`scripts/qa/staging-auth-evidence.mjs`) is the
  **blocking** identity gate in `staging-deploy.yml`. DocuStream/mashlib
  proofs are application checks and run non-blocking — keep them out of the
  auth gate and vice versa.

When touching deployment or environment code, ensure these pass:
- `pnpm policy:validate-env`
- Script guardrails in `scripts/azure/deploy.sh`
- Script guardrails in `scripts/stellar/deploy-testnet.sh`

## Agent operating model
If the task is part of multi-agent execution:
- Read `.agents/project-manager/todo.md` and `.agents/shared-inbox/inbox.md` before starting.
- Respect role boundaries in `.agents/agents/*.md`.
- Post handoff evidence to `.agents/shared-inbox/inbox.md` after work.
- Include changed files, validation evidence, and explicit next owner.

Use PM automation scripts where appropriate:
- `pnpm pm:dispatch`
- `pnpm pm:status`
- `pnpm pm:followup`
- `pnpm pm:reintegrate`

## Implementation quality bar
- Keep changes minimal and scoped to the requested objective.
- Avoid unrelated refactors and broad reformatting.
- Maintain existing public APIs unless change is explicitly required.
- Update docs/checklists when behavior, env vars, or deployment flow changes.
- Never commit secrets, credentials, tokens, or private keys.

## Validation expectations
Run relevant checks for touched scope.

Workspace-level default checks:
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`
- `pnpm policy:validate-env`

Staging gate checks (when relevant):
- `pnpm qa:smoke`
- `pnpm qa:smoke:auth` (blocking identity gate: new-user onboarding + returning-user authentication E2E)
- Manual journeys in `docs/staging-uat-checklist.md`

Application-feature proofs (`pnpm qa:smoke:docustream-pane`, `qa:smoke:mashlib-*`)
are NOT part of the identity gate; run them separately for feature work.

Package-focused checks are acceptable for scoped changes (for example `pnpm --filter <pkg> type-check`) when full-suite execution is not required.

## Windows shell note
On Windows environments where `pnpm` is not on PATH, prefer `corepack pnpm ...`.
