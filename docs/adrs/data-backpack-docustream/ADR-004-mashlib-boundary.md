# ADR-004: Mashlib Boundary and Integration Strategy

Status: Accepted
Date: 2026-07-05
Owners: Adapter and experience owner
Target decision date: 2026-07-19
Decision drivers:
- Platform parity between web and mobile
- Optionality of web-specific libraries
- Long-term maintainability of core domain/persistence layers
- Ability to replace adapter technology without contract churn

## Context

Mashlib and related SolidOS UI libraries are strong candidates for advanced linked-data exploration on web surfaces.

The integration question is where mashlib sits in the architecture:
- Web-only adapter boundary (recommended by runbook baseline)
- Shared runtime dependency across core layers

## Decision

Adopt a web-only adapter boundary for mashlib in v1.

Core domain, contract, persistence, query, and sync layers remain mashlib-independent.
Mashlib may power optional web exploration and pane experiences only.

## Rationale

This preserves cross-platform parity, keeps core runtime portable, and limits
replacement risk if web adapter choices evolve.

## Consequences

Positive:
- Mobile and web share the same core semantics without library coupling.
- Lower blast radius for adapter experimentation.
- Clear separation of concerns between platform UI and core data behavior.

Negative:
- Some web-only capabilities require explicit adapter mapping work.
- Teams must resist leaking adapter-specific concepts into core contracts.

## Rejected alternatives

1. Shared runtime coupling
- Reason rejected: Cross-platform lock-in and elevated maintenance risk.

## Validation plan

- Confirm core layer APIs remain mashlib-independent
- Verify mobile feature parity for critical semantics
- Validate web adapter replacement feasibility (bounded blast radius)

## Links

- Runbook: `docs/data-backpack-docustream-foundation-runbook.md`
- Tracker: `docs/data-backpack-docustream-weekly-execution-tracker.md`
