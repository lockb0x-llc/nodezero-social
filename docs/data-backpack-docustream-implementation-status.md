# Data Backpack + DocuStream Implementation Status

Status date: 2026-07-05
Environment focus: staging-testnet

## Scope of this status

This document captures implementation progress and verification evidence for:

1. Phase 0 ADR closure
2. Layer 3 query API skeleton
3. Layer 4 sync/dedupe baseline
4. Focused staging verification for bootstrap flag and policy behavior

## Phase status snapshot

| Phase / Layer | Status | Evidence |
|---|---|---|
| Phase 0 (ADR closure) | Completed | ADR-001..005 accepted under `docs/adrs/data-backpack-docustream/` |
| Layer 1 (contracts) | In progress (code-complete baseline) | Contract validators + conformance tests in `packages/solid-pod-sync/src/contracts/` and `src/__tests__/contract-conformance.test.ts` |
| Layer 2 (persistence + policy) | In progress (implemented baseline + app adoption) | `PodLayoutManager`, manager bootstrap hooks, shared factory + mobile app integration |
| Layer 3 (query) | In progress (skeleton implemented) | `packages/solid-pod-sync/src/QueryApi.ts` + `src/__tests__/QueryApi.test.ts` |
| Layer 4 (sync) | In progress (baseline implemented) | `packages/solid-pod-sync/src/SyncEngine.ts` + `src/__tests__/SyncEngine.test.ts` |
| Layer 5 (adapters) | Not started | Pending |

## Step 1: ADR closure evidence

Accepted decisions:

1. `docs/adrs/data-backpack-docustream/ADR-001-docustream-model-stance.md`
2. `docs/adrs/data-backpack-docustream/ADR-002-acl-default-model.md`
3. `docs/adrs/data-backpack-docustream/ADR-003-query-baseline.md`
4. `docs/adrs/data-backpack-docustream/ADR-004-mashlib-boundary.md`
5. `docs/adrs/data-backpack-docustream/ADR-005-provider-compatibility-scope.md`

ADR pack index updated:

- `docs/adrs/data-backpack-docustream/README.md`

## Step 2 and Step 3: Layer 3/4 implementation evidence

Implemented files:

- `packages/solid-pod-sync/src/QueryApi.ts`
- `packages/solid-pod-sync/src/SyncEngine.ts`
- `packages/solid-pod-sync/src/__tests__/QueryApi.test.ts`
- `packages/solid-pod-sync/src/__tests__/SyncEngine.test.ts`
- `packages/solid-pod-sync/src/index.ts` (exports)

Verification commands and outcomes:

1. `corepack pnpm --filter @nodezero/solid-pod-sync type-check`
- Outcome: PASS

2. `corepack pnpm --filter @nodezero/solid-pod-sync test`
- Outcome: PASS
- Evidence summary: 7 suites passed, 42 tests passed, snapshots passed

3. `corepack pnpm --filter @nodezero/mobile-app type-check`
- Outcome: PASS

## Step 4: focused staging verification evidence

### Bootstrap flag resolution check

Command:

`node -e "const cfg=require('./packages/mobile-app/app.config.js'); console.log(JSON.stringify({envProfile:cfg.extra.envProfile,solidBootstrapEnabled:cfg.extra.solidBootstrapEnabled,nodeZeroIssuerUrl:cfg.extra.nodeZeroIssuerUrl,relayUrl:cfg.extra.relayUrl}, null, 2));"`

With staging env vars set (including `NZ_SOLID_BOOTSTRAP_ENABLED=true`), output confirms:

- `envProfile`: `staging-testnet`
- `solidBootstrapEnabled`: `true`
- `nodeZeroIssuerUrl`: `https://solid.nodezero.social/`
- `relayUrl`: `wss://relay.staging.nodezero.social`

### Focused policy/bootstrap behavior tests

Command:

`corepack pnpm --filter @nodezero/solid-pod-sync test -- PodLayoutManager.test.ts new-features.test.ts createSolidPodSyncManagers.test.ts`

Outcome:

- PASS (3 suites, 16 tests)

### Environment isolation guardrails

Command:

`corepack pnpm policy:validate-env`

Outcome:

- PASS
- Reported checks:
  - Canonical staging domain references validated
  - Azure deployment script guardrails validated
  - Stellar deployment script guardrails validated
  - Mobile runtime profile guardrails validated
  - Bicep environment guardrails validated

## Remaining implementation gaps

1. Layer 3 is a skeleton and needs integration into feed/docustream retrieval paths.
2. Layer 4 needs integration with real ingestion/update flow and persistence strategy for sync state.
3. Layer 5 adapter work remains pending.
4. Staging runtime verification should be expanded from command/test checks to a scripted end-to-end smoke flow.

## Next execution slice

1. Integrate `QueryApi` into existing feed/docustream retrieval call paths behind a feature gate.
2. Integrate `SyncEngine` into ingestion pathway with deterministic event-id generation and replay handling.
3. Add one staging smoke script that toggles bootstrap and verifies container + ACL outcomes against a test Pod.
