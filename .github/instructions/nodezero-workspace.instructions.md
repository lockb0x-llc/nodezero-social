---
applyTo: "**"
---

# NodeZero Repository Context

## System purpose
Build and maintain NodeZero Social: a decentralized social app that integrates Solid Pods, Stellar Soroban contracts, ZK artifacts, Expo web/mobile clients, and Azure-hosted staging infrastructure.

## Technical baseline
- Monorepo: pnpm workspaces.
- Languages: TypeScript (app/services/libs) and Rust (contracts).
- App: Expo Router + React Native + web export.
- Data identity layer: Solid libraries.
- Chain layer: Stellar SDK + Soroban contract deployment scripts.
- Infra: Azure Bicep with scripted deploy and policy checks.

## Package ownership map
- `packages/mobile-app`: user flows, route UX, runtime env wiring.
- `packages/embedded-wallet`: key management and Stellar invocation helpers.
- `packages/solid-pod-sync`: Pod read/write and profile graph integration.
- `packages/p2p-comms`: local messaging protocols and signaling client APIs.
- `packages/relay-service`: relay runtime used by p2p signaling.
- `packages/geo-discovery`: H3 geospatial discovery utilities.
- `packages/zk-crypto`: circom pipelines and artifact generation.
- `packages/contracts`: Soroban smart contract source and tests.
- `infrastructure/azure`: staging/mainnet environment provisioning templates.

## Current implementation snapshot (staging-testnet)
- The authenticated web navigation includes a dedicated `Directory` tab
	between `Feed` and `Backpack`.
- Community Directory is implemented as its own route (`/directory`) and is
	no longer profile-embedded.
- Directory Trust Circle actions are available, but audience recipient
	targeting remains connection-driven through
	`packages/mobile-app/src/social/composeRecipients.ts`.
- `pnpm qa:smoke:community-directory` provides tab-order and directory
	acceptance evidence.
- Authentication is 100% internal (cutover complete): the provisioner issues
	NodeZero sessions and proxies all Pod traffic (`/v1/pod-proxy/*`); the
	browser never contacts the Community Server and there are no user-facing
	passwords, OIDC redirects, or bridge tickets.
- Returning sign-in supports multi-account disambiguation: if one device
	Stellar identity maps to multiple NodeZero accounts, the app surfaces an
	internal account chooser and retries sign-in with the selected WebID.
- In CI, `pnpm qa:smoke:auth` remains the blocking identity gate; it runs
	without retries because session issuance has no redirect-timing window.

Keep edits constrained to the relevant package unless cross-package changes are explicitly required.

## Non-negotiable environment rules
Always preserve environment isolation constraints from `docs/environment-isolation-matrix.md`.

Required profile values:
- `local`
- `staging-testnet`
- `production-mainnet`

Hard rules:
- Never mix Stellar TestNet and MainNet passphrase/RPC/contract identifiers.
- Never target production domain from staging flows.
- Never bypass production protection in staging scripts.
- Never use example parameters file for real deployment.
- Authentication is internal-only (session invariant: signed in ⟺ the provisioner can mint a live Solid token now). Never reintroduce browser↔CSS auth surfaces: no `@inrupt/solid-client-authn-browser`, no OIDC redirect/bridge legs, no user-facing passwords. The Node Zero Community Server (`https://solid.nodezero.social/`) is the Pod host only. Never build/deploy a web bundle without `NZ_ENV_PROFILE`, `NZ_NODEZERO_ISSUER_URL`, and `NZ_JSS_PROVISIONER_URL` resolved.

When modifying env or deploy logic, verify:
- `scripts/policy/validate-env-isolation.sh` still passes.
- `packages/mobile-app/app.config.js` profile guards remain intact.
- `scripts/azure/deploy.sh` what-if and env-matching checks remain intact.
- `scripts/stellar/deploy-testnet.sh` strict testnet invariants remain intact.

## Agent collaboration protocol
When working under PM orchestration:
- Read `.agents/README.md` and `.agents/RUNBOOK.md` first.
- Consume task assignments from `.agents/project-manager/todo.md` and `.agents/shared-inbox/inbox.md`.
- Follow role card instructions in `.agents/agents/*.md`.
- Publish concise handoff evidence in inbox format with status, context, evidence, and due time.

Do not mark work complete without objective evidence.

## Editing and review priorities
Prefer correctness and release safety over feature breadth.

## Deployment Verification Policy
Before troubleshooting a staging or deployed behavior locally, verify the
latest relevant GitHub Actions deployment run for the target branch and
environment:
- Confirm its conclusion is `success`, not merely that Azure endpoints respond.
- Confirm the deployed commit/run provenance matches the code under
  investigation (use the staging `deploy-marker.json` where available).
- If the latest deployment failed, inspect its failed job logs and fix or
  explicitly account for that release failure before drawing conclusions from
  direct/manual infrastructure changes.
- Do not describe staging as updated, validated, or release-ready unless the
  latest relevant workflow run is successful and its blocking gates passed.

Manual Azure deployments are recovery tools, not release evidence. After any
manual deployment, reconcile the workflow and obtain a successful GitHub
Actions deployment before treating the change as delivered.

Priority order:
1. Environment safety and chain/cloud invariants.
2. User-visible functional correctness.
3. Testability and observability.
4. Maintainable interfaces and docs alignment.

For reviews, prioritize:
- Cross-environment leakage risk.
- Deployment/regression risk.
- Missing validation evidence.
- Incomplete docs or runbook drift.

## Validation matrix
For most code changes, run at least:
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`

For infra/env/deploy changes, additionally run:
- `pnpm policy:validate-env`

For staging readiness or release work, additionally run:
- `pnpm qa:smoke`
- `pnpm qa:smoke:auth` (blocking onboarding/authentication E2E gate — identity only)
- Manual checks from `docs/staging-uat-checklist.md` (document PASS/FAIL)

Keep concerns separated: `qa:smoke:auth` gates identity (Pod/WebID creation,
lockb0x anchoring, ZK attestation, inline session issuance, returning one-tap
Stellar sign-in, fail-closed session enforcement); application-feature proofs
(docustream/mashlib) run separately and must never be folded into the auth
gate.

If full-suite execution is not feasible, run targeted package checks and explicitly state what was not run.

## Delivery expectations
- Keep diffs focused and minimal.
- Preserve public API compatibility unless task requires a breaking change.
- Update docs when behavior, configuration, scripts, or release process changes.
- Include file-level evidence and concise rationale in handoffs.
- Never include secrets or private credentials in code, logs, or documentation.

## Practical command notes
- In this repository, `pnpm` may be unavailable directly in some Windows shells; use `corepack pnpm` when needed.
- Prefer repository scripts over ad hoc command variants so policy and guardrails are consistently enforced.
