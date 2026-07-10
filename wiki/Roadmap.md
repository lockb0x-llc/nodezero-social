# Roadmap

## Current status (2026-07-09)

- Staging/TestNet is live and operational.
- Release-close cleanup for v0.0.2 is complete.
- Docustream staging stabilization is complete (source add/ingest/render +
	session continuity hardening).
- Remaining work is hardening and production-mainnet promotion separation.

## Current priorities

- Codify relay lifecycle and recovery in IaC/workflow.
- Move provisioner `JSS_*` runtime settings into deterministic workflow steps.
- Add gated drift-detection and config consistency checks.
- Expand larger-data social graph/feed/docustream validation evidence.
- Complete production-mainnet workflow guardrails and approval gates.

## Next feature readiness checklist

- Lock in stabilized docustream/auth behavior as baseline for new feature work.
- Keep focused verification green (`solid-pod-sync` tests + mobile app type-check).
- Capture feature kickoff requirements in the execution tracker before coding.

## Source of truth

- ../docs/staging-runtime-implementation-roadmap.md
- ../docs/staging-readiness-and-agent-plan.md
- ../docs/staging-deployment-blueprint.md
