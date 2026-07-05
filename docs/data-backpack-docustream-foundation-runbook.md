# Data Backpack + DocuStream Foundation Runbook

Status: Draft for execution kickoff
Last updated: 2026-07-04
Primary environment: staging-testnet

## 1) Purpose

This runbook defines how NodeZero should lay the foundation for Data Backpack and DocuStream features before broad UI build-out.

It turns strategy into execution by specifying:
- Layered build order
- Workstreams and ownership
- Required architecture decisions
- Concrete deliverables per phase
- Validation gates and Definition of Done
- Rollout and risk controls

This runbook is implementation-oriented but does not force immediate feature coding. It is the planning artifact used to coordinate kickoff and execution.

## 2) Scope and Non-Goals

### In scope

- Foundational layers for Pod-native social features:
  - Domain contracts
  - Pod persistence and policy
  - Graph/query capability
  - Sync/change propagation
  - Experience adapters (including web-only mashlib adapter)
- Planning for Data Backpack, DocuStream, and Social Graph feature surfacing
- Staging-testnet readiness criteria

### Out of scope (for this runbook)

- Full production-mainnet launch process
- Pixel-final UX copy and visual design polish
- Complete plugin marketplace implementation
- Non-Solid fallback architecture

## 3) Reference Baseline

Current architecture and package boundaries are defined in:
- docs/architecture.md
- docs/staging-runtime-implementation-roadmap.md
- docs/adrs/data-backpack-docustream/README.md
- docs/data-backpack-docustream-weekly-execution-tracker.md

Current Pod foundations already present:
- packages/solid-pod-sync/src/ProfileManager.ts
- packages/solid-pod-sync/src/SocialGraph.ts
- packages/solid-pod-sync/src/DocustreamManager.ts
- packages/mobile-app/src/contexts/SolidContext.tsx

These files are the baseline. New work should extend these seams instead of replacing them.

## 4) Design Principles

1. Pod-first source of truth
- User data is authoritative in user Pods.
- NodeZero services orchestrate, validate, and optionally index.
- NodeZero services do not become primary data silos.

2. Contract-first delivery
- Define schemas, semantics, and policy behaviors first.
- UI and integration implementations must conform to contracts.

3. Layer isolation
- Build each capability layer behind stable interfaces.
- Keep adapter logic (web/mashlib/mobile) separated from domain and persistence logic.

4. Environment safety
- Preserve environment isolation for local, staging-testnet, and production-mainnet.
- No cross-environment leakage in configuration, contract IDs, domains, or build outputs.

5. Incremental adoption of SolidOS stack
- rdflib.js and graph capabilities can be introduced into core libraries first.
- mashlib usage is web-first adapter behavior, not mandatory core runtime.

## 5) Layered Build Strategy

## Layer 1: Domain Contracts

Goal:
- Establish canonical data contracts for Data Backpack and DocuStream.

Outputs:
- Namespace and JSON-LD context spec
- Entity definitions and required fields
- Versioning and migration strategy
- Event identity rules and lifecycle semantics

Acceptance:
- Every core feature can be expressed using contract entities.
- Contract conformance tests exist and pass for fixture datasets.

## Layer 2: Pod Persistence + Policy

Goal:
- Standardize Pod container layout, ACL defaults, and policy transitions.

Outputs:
- Canonical Pod path map for Data Backpack and DocuStream resources
- ACL inheritance/default policy matrix
- Safe policy transition procedures (private -> audience -> public)
- Audit and rollback policy requirements

Acceptance:
- Deterministic bootstrap for required containers
- Policy tests show no accidental overexposure
- ACL operations are idempotent and environment-safe

## Layer 3: Graph + Query Capability

Goal:
- Add graph-native query behavior for intent and relationship-driven retrieval.

Outputs:
- Query API surface for timeline, audience, topic, and intent filters
- Cross-document linking rules
- Reference index strategy (where needed)

Acceptance:
- Stream retrieval does not depend on brittle file-path-only reads
- Query correctness tests pass for mixed datasets

## Layer 4: Sync + Change Propagation

Goal:
- Define predictable freshness, conflict handling, and replay-safe updates.

Outputs:
- Sync model (polling baseline, notifications-compatible extension path)
- Idempotency and dedupe rules
- Conflict resolution policy

Acceptance:
- Multi-session update consistency tests pass
- Duplicate event replay does not corrupt state

## Layer 5: Experience Adapters

Goal:
- Surface user features through platform-specific adapters while preserving shared core behavior.

Outputs:
- Native adapter behavior for Expo app screens
- Web adapter behavior including optional mashlib-powered explorer
- Extension seam for pane-like modular experiences

Acceptance:
- Core feature semantics match across web and mobile
- Adapter swaps do not require domain contract changes

## 6) Feature Requirement Matrix

## Data Backpack

Core requirements:
- Canonical schema/versioning
- Private/public partitioning model
- Access policy and ACL controls
- Migration compatibility policy
- Backup/export semantics

Dependent layers:
- Mandatory: Layers 1 and 2
- Recommended: Layer 3

## DocuStream

Core requirements:
- Append semantics with stable event identity
- Intent, audience, and topic metadata
- Queryable timeline and contextual filters
- Cross-linking across entities and sources
- Update propagation and dedupe controls

Dependent layers:
- Mandatory: Layers 1, 3, and 4
- Adapter surfacing: Layer 5

## Social Graph

Core requirements:
- Canonical relationship model
- Connection lifecycle semantics
- Relationship-aware retrieval/filtering
- Safe policy controls for visibility

Dependent layers:
- Mandatory: Layers 1 and 2
- Recommended: Layer 3

## 7) Workstreams and Ownership

## Workstream A: Contracts and Semantics

Primary owner:
- solid-pod-sync maintainers

Responsibilities:
- Data contract specification
- Semantic definitions and examples
- Versioning and compatibility

Deliverables:
- Contract specification doc
- JSON-LD context draft
- Fixture dataset pack

## Workstream B: Persistence and Policy

Primary owner:
- solid-pod-sync + mobile-app integration owners

Responsibilities:
- Pod structure and bootstrap
- ACL policy operations and tests
- Safety and rollback behavior

Deliverables:
- Pod layout and policy matrix
- ACL test plan and evidence
- Fail-safe procedures

## Workstream C: Query and Retrieval

Primary owner:
- solid-pod-sync maintainers

Responsibilities:
- Query API contracts
- Graph-based retrieval behavior
- Performance and correctness baselines

Deliverables:
- Query API proposal
- Retrieval benchmark and correctness report

## Workstream D: Sync and Events

Primary owner:
- mobile-app + sync maintainers

Responsibilities:
- Freshness policy
- Replay/dedupe/conflict behavior
- Offline/online transition semantics

Deliverables:
- Sync model spec
- Conflict test matrix

## Workstream E: Adapter and Experience

Primary owner:
- mobile-app and web adapter owners

Responsibilities:
- Native and web adapter strategy
- Optional mashlib adapter boundaries
- Cross-platform semantics parity checks

Deliverables:
- Adapter integration map
- Mashlib usage boundary ADR

## 8) Phase Plan (Execution Sequence)

## Phase 0: Kickoff and Decision Capture (Week 0-1)

Objectives:
- Align stakeholders on architecture and scope
- Resolve blocker decisions

Required decisions:
1. DocuStream model stance: event-log first vs mutable document first
2. ACL model: strict container defaults vs per-resource specialization
3. Query baseline: minimal path reads vs graph query baseline
4. mashlib boundary: web-only adapter vs deeper runtime coupling
5. Compatibility scope: provider variance tolerance for v1

Outputs:
- Approved ADR set
- Finalized feature and layer scope
- Execution roster and owners

## Phase 1: Contract Foundation (Week 1-3)

Objectives:
- Define and freeze v1 contracts for Data Backpack and DocuStream

Outputs:
- Contract spec and fixtures
- Versioning and migration rules
- Conformance test scaffolding

Gate to Phase 2:
- Contract tests pass in CI
- No unresolved schema blockers

## Phase 2: Persistence + Policy Foundation (Week 3-5)

Objectives:
- Stabilize Pod storage and ACL policy controls

Outputs:
- Container bootstrap logic plan
- ACL behavior matrix and tests
- Staging safety checks

Gate to Phase 3:
- Policy tests pass in staging
- No critical policy leakage findings

## Phase 3: Query + Sync Foundation (Week 5-7)

Objectives:
- Enable graph-aware retrieval and deterministic sync behavior

Outputs:
- Query API and retrieval tests
- Sync/replay/dedupe policy and tests

Gate to Phase 4:
- Retrieval and sync acceptance criteria pass
- Baseline performance and correctness acceptable

## Phase 4: Adapter Surfacing Plan (Week 7-8)

Objectives:
- Prepare user feature surfacing against stable foundations

Outputs:
- Native and web adapter implementation plan
- Optional mashlib DocuStream explorer plan
- Rollout order by risk

Exit criteria:
- Feature teams can build against frozen interfaces
- No architectural ambiguity for first implementation wave

## 9) Mashlib-Specific Strategy for DocuStream

Position:
- mashlib is recommended as a web adapter for advanced DocuStream exploration and composition.
- mashlib is not the source-of-truth domain model.

Use cases in this plan:
- Web-only interactive stream exploration
- Pane-style visualizations for linked stream artifacts
- Rich linked-data browsing/debugging workflows

Constraints:
- Keep mashlib behind an adapter boundary
- Do not couple mobile runtime to mashlib assumptions
- Preserve parity of core feature semantics between platforms

Success criteria:
- Removing or replacing mashlib adapter does not require contract changes
- Web and mobile continue to use common domain and persistence layers

## 10) Readiness Gates and Definition of Done

A phase is complete only when all criteria are met.

## DoD for Layer 1

- Contract documentation approved
- Schema fixtures published
- Contract conformance tests passing in CI

## DoD for Layer 2

- Pod path layout fixed and documented
- ACL matrix approved and tested
- Safety checks pass in staging-testnet

## DoD for Layer 3

- Query API stable and documented
- Cross-document retrieval tests pass
- Performance baseline captured

## DoD for Layer 4

- Sync and dedupe policy documented
- Replay/conflict tests pass
- No critical correctness defects open

## DoD for Layer 5

- Adapter behavior spec approved
- Platform parity checks pass for critical feature paths
- Rollout checklist approved

## 11) Validation and Evidence Plan

Validation categories:
- Contract correctness
- Policy safety
- Retrieval accuracy
- Sync consistency
- Cross-platform semantic parity

Evidence required:
- Test outputs stored in CI artifacts
- Staging validation notes captured in docs
- Pass/fail markers recorded in roadmap tracking docs

Recommended baseline checks before feature implementation starts:
- corepack pnpm lint
- corepack pnpm type-check
- corepack pnpm test
- corepack pnpm policy:validate-env

If a full suite is not feasible, run targeted package checks and explicitly document gaps.

## 12) Risk Register

1. Schema drift across feature teams
- Mitigation: contract freeze and conformance tests before broad implementation

2. ACL misconfiguration and privacy exposure
- Mitigation: deterministic defaults, explicit transition procedures, staging policy tests

3. Provider variance across Solid servers
- Mitigation: capability checks, compatibility matrix, adapter fallbacks

4. Over-coupling to mashlib or any UI library
- Mitigation: strict adapter boundary and contract-first core

5. Environment leakage between staging and production
- Mitigation: enforce isolation checks and environment-specific validation gates

## 13) Kickoff Checklist

Before implementation begins, confirm:
- [ ] ADRs for all critical decisions are approved
- [ ] Contract specification is approved
- [ ] Pod layout and ACL matrix are approved
- [ ] Query and sync baseline designs are approved
- [ ] Adapter boundary strategy (including mashlib role) is approved
- [ ] Validation gates and evidence format are agreed
- [ ] Owner roster and review cadence are set

## 14) First Feature Surfacing Order (After Foundation Gates)

1. Data Backpack baseline controls and visibility management
2. DocuStream create/read timeline with intent and audience metadata
3. Social graph-aware DocuStream filtering
4. Sync/live update improvements
5. Web-only advanced DocuStream explorer using mashlib adapter

## 15) Operating Cadence

Weekly execution loop:
1. Review open decisions and blocker status
2. Review layer gate progress against DoD
3. Review risk register updates
4. Publish evidence links and status changes

Recommended artifacts to update each week:
- docs/staging-runtime-implementation-roadmap.md
- this runbook
- docs/data-backpack-docustream-weekly-execution-tracker.md
- docs/adrs/data-backpack-docustream/README.md
- relevant package-level design notes

## 16) Change Control

Any change to:
- core contracts
- Pod path layout
- ACL defaults
- query/sync semantics

must include:
1. ADR update
2. migration impact note
3. updated validation criteria
4. explicit approval from layer owners

---

This document is the planning source for beginning implementation safely. Build only after the corresponding layer gates are approved.
