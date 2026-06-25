# Project Manager Todo Board

## Status legend
- TODO
- IN_PROGRESS
- BLOCKED
- DONE

## Milestone A: Build and release hygiene
- [DONE] A1: Normalize package scripts and fix manifest anomalies.
- [DONE] A2: Add CI pipelines for lint, type-check, test, contracts.
- [DONE] A3: Define release environment variable matrix for staging.

## Milestone B: Functional completion
- [IN_PROGRESS] B1: Replace feed placeholder with Solid-based aggregation.
- [IN_PROGRESS] B2: Replace local chat placeholder with live P2P relay flow.
- [DONE] B3: Deliver relay backend for SignalRelay endpoint. (merged to main: /health + /healthz + Dockerfile)
- [DONE] B4: Make Solid auth cross-platform safe for Expo web/native. (merged to main: IdP validation, env coherence, safer redirect)

## Milestone C: Chain and ZK reliability
- [DONE] C1: Harden contract deployment sequence and initialization. (merged to main: Lockb0x initialization-proof gate)
- [IN_PROGRESS] C2: Publish artifact manifest validation and checksum process.

## Milestone D: Azure staging readiness
- [IN_PROGRESS] D1: Add custom domain/TLS configuration runbook.
- [DONE] D2: Add SWA publish workflow from Expo web build. (merged to main: build:web + SWA publish + landing smoke)
- [TODO] D3: Add monitoring/alerting and cost guardrails.

## Milestone E: Validation and launch
- [DONE] E1: End-to-end smoke suite and manual UAT checklist. (merged to main: scripts/qa/staging-smoke.sh + docs/staging-uat-checklist.md + qa:smoke)
- [TODO] E2: Staging sign-off and release announcement.

## Milestone F: Multi-agent parallel delivery ops
- [DONE] F1: Add PM branch/worktree dispatch automation.
- [DONE] F2: Add PM merge-queue reintegration automation.
- [DONE] F3: Add PM status and follow-up control loop.
- [DONE] F4: Add bounded PM loop mode for recurring oversight.
