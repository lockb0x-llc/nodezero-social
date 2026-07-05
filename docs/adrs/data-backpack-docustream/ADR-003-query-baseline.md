# ADR-003: Query Baseline for Data Backpack and DocuStream

Status: Accepted
Date: 2026-07-05
Owners: Query and retrieval owner
Target decision date: 2026-07-19
Decision drivers:
- Retrieval correctness for mixed datasets
- Complexity and maintenance cost
- Performance on large Pod collections
- Future extensibility for semantic filters

## Context

The baseline retrieval strategy can start as:
- Minimal path-based reads (container scan + document-level parsing)
- Graph-query baseline (RDF graph layer with query abstractions)

Choice impacts API shape, portability, and future feature velocity.

## Decision

Adopt a graph-query baseline for v1 behind a stable query API.

Path-based reads remain as implementation detail for source ingestion, but feature
retrieval surfaces through graph-aware filters and timeline semantics.

## Rationale

This keeps retrieval extensible for audience/topic/intent filters and avoids
hard-coding UI behavior to file path conventions.

## Consequences

Positive:
- Query semantics are explicit and testable as API contracts.
- Supports future linked-data expansion without API churn.
- Reduces coupling between storage layout and user-facing retrieval logic.

Negative:
- Slightly higher initial implementation complexity than path-only reads.
- Requires benchmark and correctness discipline early.

## Rejected alternatives

1. Minimal path-based reads
- Reason rejected: Too brittle for required intent/audience/topic filtering goals.

## Validation plan

- Query correctness tests for timeline/audience/topic/intent
- Performance benchmark on representative fixture datasets
- Cross-document linking consistency tests

## Links

- Runbook: `docs/data-backpack-docustream-foundation-runbook.md`
- Tracker: `docs/data-backpack-docustream-weekly-execution-tracker.md`
