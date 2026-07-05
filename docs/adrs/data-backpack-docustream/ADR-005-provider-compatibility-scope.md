# ADR-005: Solid Provider Compatibility Scope (v1)

Status: Accepted
Date: 2026-07-05
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

Adopt a validated-subset compatibility scope for v1.

v1 is explicitly validated first on NodeZero-hosted CSS and a documented subset of
external provider capabilities. Unsupported capabilities use documented fallbacks.

## Rationale

This keeps delivery risk controlled while preserving an extension path for broader
provider compatibility in later phases.

## Consequences

Positive:
- Predictable support expectations for launch.
- Lower operational risk for ACL and query semantics.
- Clear capability matrix for staged expansion.

Negative:
- Some external providers will operate in reduced mode initially.
- Requires transparent communication of capability limits.

## Rejected alternatives

1. Broad best-effort support
- Reason rejected: High behavioral variance and support burden for v1 timeline.

## Validation plan

- Capability matrix by provider and feature area
- Smoke tests for core flows (auth, profile, docustream, ACL)
- Documented fallback behavior for unsupported capabilities

## Links

- Runbook: `docs/data-backpack-docustream-foundation-runbook.md`
- Tracker: `docs/data-backpack-docustream-weekly-execution-tracker.md`
