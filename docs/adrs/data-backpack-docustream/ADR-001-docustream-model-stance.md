# ADR-001: DocuStream Model Stance

Status: Accepted
Date: 2026-07-05
Owners: Contracts and semantics owner
Target decision date: 2026-07-19
Decision drivers:
- Deterministic append semantics
- Queryability across timeline and intent filters
- Replay safety and dedupe behavior
- Migration complexity over time

## Context

DocuStream can be implemented with either:
- Event-log-first semantics (immutable append records)
- Mutable-document-first semantics (single evolving records)

The selected stance impacts identity rules, sync complexity, retention behavior, and tooling.

## Decision

Adopt an event-log-first DocuStream model for v1.

DocuStream records are immutable append events with stable event identity.
Updates are represented by new events rather than in-place mutation.

## Rationale

This model gives deterministic ordering, simplifies replay safety, and aligns with
dedupe and sync goals in Layer 4.

## Consequences

Positive:
- Deterministic timeline reconstruction from append-only events.
- Cleaner dedupe semantics (event ID is authoritative).
- Lower risk of silent overwrite conflicts across clients.

Negative:
- Storage growth over time requires retention and compaction policy.
- Consumers must resolve latest state from event streams when needed.

## Rejected alternatives

1. Mutable-document-first
- Reason rejected: Higher conflict risk and weaker replay/audit guarantees.

## Validation plan

- Contract fixture tests for append/update flows
- Replay and dedupe tests
- Timeline query correctness tests

## Links

- Runbook: `docs/data-backpack-docustream-foundation-runbook.md`
- Tracker: `docs/data-backpack-docustream-weekly-execution-tracker.md`
