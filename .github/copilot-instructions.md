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

## Current implementation snapshot (staging-testnet)
- Web navigation includes a dedicated `Directory` tab positioned between
  `Feed` and `Backpack`.
- Community Directory is implemented on `/directory` (not profile-embedded)
  with refresh, connect actions, and Trust Circle actions.
- Broadcast recipient resolution is centralized in
  `packages/mobile-app/src/social/composeRecipients.ts`; directory-only
  Trust Circle entries do not become recipients unless they are real
  connections.
- `pnpm qa:smoke:community-directory` provides acceptance evidence for tab
  sequence and directory availability.
- Authentication is 100% internal (cutover complete): NodeZero sessions are
  issued by the provisioner and all Pod traffic flows through the Pod Access
  Proxy (`/v1/pod-proxy/*`). The staging deploy workflow keeps
  `pnpm qa:smoke:auth` as a blocking gate (no retry — session issuance has
  no redirect-timing window).
- Returning sign-in supports multi-account disambiguation: when one local
  Stellar identity maps to multiple NodeZero accounts, the app presents an
  internal account chooser and retries `/v1/auth/stellar-token` with the
  selected `webId`.

## Mandatory policy constraints
Preserve environment isolation at all times:
- Allowed profiles: `local`, `staging-testnet`, `production-mainnet`.
- Never mix testnet values with mainnet values.
- Staging deploy target is `staging.nodezero.social`.
- Production mainnet deployment is not allowed from staging scripts.
- Do not deploy with `infrastructure/azure/main.parameters.example.json`.

## Identity provider policy
- NodeZero operates its own hosted Solid server: the **Node Zero Community Server** at `https://solid.nodezero.social/` (Community Solid Server on Azure Container Apps, `infrastructure/azure/solid-server.bicep`). It is the Pod host — **users never authenticate against it**.
- Authentication is internal-only: the provisioner (`packages/jss-provisioner`) is the sole identity authority. `solidcommunity.net`/external IdPs are not offered anywhere.
- `NZ_NODEZERO_ISSUER_URL` identifies the Pod host origin (URL recognition + WebID derivation). `NZ_JSS_PROVISIONER_URL` identifies the session/proxy authority. `app.config.js` fails strict-profile builds if either is missing.
- Web bundles MUST be built with `NZ_ENV_PROFILE=staging-testnet` (or production) and the full variable set. The staging workflow's "Build Expo web artifact" step is the reference variable set.

## Authentication flow contract (separation of concerns)
Onboarding/authentication is a standalone concern, separate from application
features (feed, docustream, backpack, etc.). Application features consume an
authenticated session; they never participate in establishing one.

- **Session invariant (fail-closed):** signed in ⟺ the provisioner can mint
  a live DPoP-bound Solid token for the user's Pod right now. Issuance
  requires a successful token mint + Pod probe; the Pod Access Proxy
  revalidates on every request; `401 session_invalid` destroys the client
  session and returns the user to the sign-in page. There is no degraded or
  half-authenticated state.
- The user's only credential is the device Stellar keypair (challenge →
  on-device Ed25519 signature → session). There are **no user-facing
  passwords**: the CSS account password is generated server-side at
  provisioning, used once, and discarded. Never reintroduce password inputs,
  OIDC redirects, bridge tickets, or `@inrupt/solid-client-authn-browser`.
- The browser never contacts the CSS origin. All Pod reads/writes flow
  through `/v1/pod-proxy/*` with the NodeZero bearer token; per-user client
  credentials live encrypted (AES-256-GCM) in the provisioner credential
  store and never reach the client.
- The client-side on-chain lockb0x attestation check
  (`attestationStatus === 'verified'`) remains a second, independent gate
  after session issuance. See `docs/architecture.md` → "Authentication and
  session handoff".
- `pnpm qa:smoke:auth` (`scripts/qa/staging-auth-evidence.mjs`) is the
  **blocking** identity gate in `staging-deploy.yml` (no retry). It asserts
  onboarding, returning one-tap sign-in, fail-closed rejection, on-chain
  evidence, and a zero-CSS-contact request embargo. DocuStream/mashlib
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
