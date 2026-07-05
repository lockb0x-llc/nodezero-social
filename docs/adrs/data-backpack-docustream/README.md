# Data Backpack + DocuStream ADR Pack

Status: Draft templates
Last updated: 2026-07-04

This directory contains the Phase 0 Architecture Decision Record templates referenced by the foundation runbook.

## Scope

These ADRs cover the five blocker decisions required before implementation kickoff:

1. `ADR-001-docustream-model-stance.md`
2. `ADR-002-acl-default-model.md`
3. `ADR-003-query-baseline.md`
4. `ADR-004-mashlib-boundary.md`
5. `ADR-005-provider-compatibility-scope.md`

## How to use this pack

1. Copy each template into an approved ADR file (or promote the template itself by filling fields).
2. Set `Status` to one of: `Proposed`, `Accepted`, `Rejected`, `Superseded`.
3. Record owner and approval date.
4. Link impacted code/docs and validation evidence.
5. Update the runbook and staging roadmap when a decision is accepted.

## Change control

Any accepted decision in this ADR pack that changes contracts, Pod layout, ACL defaults, query semantics, or sync behavior must also update:
- `docs/data-backpack-docustream-foundation-runbook.md`
- `docs/data-backpack-docustream-weekly-execution-tracker.md`
- `docs/staging-runtime-implementation-roadmap.md`
