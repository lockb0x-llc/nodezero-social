# ADR-005: Solid Provider Compatibility Scope (v1)

Status: Proposed
Date: 2026-07-04
Owners: Program lead, Persistence and policy owner
Target decision date: 2026-07-19
Decision drivers:
- Reliability across NodeZero-hosted CSS and external Pod providers
- Feature support variability (WAC, notifications, API differences)
- Time-to-delivery for v1
- User expectation management and support burden

## Context

NodeZero supports a default NodeZero Community Server issuer and secondary external Pod options. Provider behavior can vary and may affect ACL semantics, query behavior, and sync capabilities.

The v1 decision defines how broad compatibility must be at launch:
- Strictly validated subset of providers/capabilities
- Best-effort broad compatibility with fallback behaviors

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

1. Strict validated subset
- Reason rejected: TBD

2. Broad best-effort support
- Reason rejected: TBD

## Validation plan

- Capability matrix by provider and feature area
- Smoke tests for core flows (auth, profile, docustream, ACL)
- Documented fallback behavior for unsupported capabilities

## Links

- Runbook: `docs/data-backpack-docustream-foundation-runbook.md`
- Tracker: `docs/data-backpack-docustream-weekly-execution-tracker.md`
