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
- Manual checks from `docs/staging-uat-checklist.md` (document PASS/FAIL)

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
