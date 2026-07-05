# ADR-002: ACL Default Model

Status: Proposed
Date: 2026-07-04
Owners: Persistence and policy owner
Target decision date: 2026-07-19
Decision drivers:
- Privacy-by-default behavior
- Operational simplicity for container bootstrap
- Safety of policy transitions (private -> audience -> public)
- Compatibility with WAC behavior in staging CSS

## Context

Two primary policy shapes are under consideration:
- Strict container defaults with narrow inheritance
- Per-resource specialization with explicit ACL writes per object

This choice determines risk of accidental overexposure and policy maintenance burden.

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

1. Strict container defaults
- Reason rejected: TBD

2. Per-resource specialization
- Reason rejected: TBD

## Validation plan

- ACL matrix test suite for all policy transitions
- Idempotency checks for repeated ACL operations
- Staging smoke verification against CSS-hosted Pods

## Links

- Runbook: `docs/data-backpack-docustream-foundation-runbook.md`
- Tracker: `docs/data-backpack-docustream-weekly-execution-tracker.md`
