# ADR-004: Mashlib Boundary and Integration Strategy

Status: Proposed
Date: 2026-07-04
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

TBD

## Rationale

TBD

## Consequences

Positive:
- TBD

Negative:
- TBD

## Rejected alternatives

1. Web-only adapter boundary
- Reason rejected: TBD

2. Shared runtime coupling
- Reason rejected: TBD

## Validation plan

- Confirm core layer APIs remain mashlib-independent
- Verify mobile feature parity for critical semantics
- Validate web adapter replacement feasibility (bounded blast radius)

## Links

- Runbook: `docs/data-backpack-docustream-foundation-runbook.md`
- Tracker: `docs/data-backpack-docustream-weekly-execution-tracker.md`
