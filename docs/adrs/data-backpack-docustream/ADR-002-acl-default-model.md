# ADR-002: ACL Default Model

Status: Accepted
Date: 2026-07-05
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

Adopt strict container defaults as the v1 ACL model.

Policy begins with container-level defaults and uses narrowly-scoped exceptions only
when explicitly required by product behavior.

## Rationale

This minimizes accidental exposure, keeps policy reasoning simple, and supports
idempotent bootstrap operations across environments.

## Consequences

Positive:
- Privacy-by-default posture is explicit and testable.
- Lower operational complexity for bootstrap and verification.
- Easier drift detection (container ACLs become source-of-truth baseline).

Negative:
- Some fine-grained sharing scenarios require explicit exception design.
- Teams must avoid ad hoc per-resource ACL drift.

## Rejected alternatives

1. Per-resource specialization
- Reason rejected: Increased policy drift and review complexity for v1.

## Validation plan

- ACL matrix test suite for all policy transitions
- Idempotency checks for repeated ACL operations
- Staging smoke verification against CSS-hosted Pods

## Links

- Runbook: `docs/data-backpack-docustream-foundation-runbook.md`
- Tracker: `docs/data-backpack-docustream-weekly-execution-tracker.md`
