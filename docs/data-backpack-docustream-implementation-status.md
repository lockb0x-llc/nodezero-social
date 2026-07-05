# Data Backpack + DocuStream Implementation Status

Status date: 2026-07-05
Environment focus: staging-testnet

## Scope of this status

This document captures implementation progress and verification evidence for:

1. Phase 0 ADR closure
2. Layer 3 query API implementation and retrieval-path integration
3. Layer 4 sync/dedupe baseline and feed merge integration
4. Focused staging verification for bootstrap flag and policy behavior

## Phase status snapshot

| Phase / Layer | Status | Evidence |
|---|---|---|
| Phase 0 (ADR closure) | Completed | ADR-001..005 accepted under `docs/adrs/data-backpack-docustream/` |
| Layer 1 (contracts) | In progress (code-complete baseline) | Contract validators + conformance tests in `packages/solid-pod-sync/src/contracts/` and `src/__tests__/contract-conformance.test.ts` |
| Layer 2 (persistence + policy) | In progress (implemented baseline + app adoption) | `PodLayoutManager`, manager bootstrap hooks, shared factory + mobile app integration |
| Layer 3 (query) | In progress (integrated baseline) | `packages/solid-pod-sync/src/QueryApi.ts`, `src/DocustreamAggregation.ts`, `src/__tests__/QueryApi.test.ts` |
| Layer 4 (sync) | In progress (integrated + checkpoint persistence baseline) | `packages/solid-pod-sync/src/SyncEngine.ts`, `src/DocustreamAggregation.ts`, `src/__tests__/SyncEngine.test.ts`, `src/__tests__/DocustreamAggregation.test.ts`, mobile checkpoint store |
| Layer 5 (adapters) | In progress (concrete binding baseline) | `packages/solid-pod-sync/src/adapters/MashlibWebAdapter.ts` + `src/__tests__/MashlibWebAdapter.test.ts` |

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
- `packages/solid-pod-sync/src/DocustreamAggregation.ts`
- `packages/solid-pod-sync/src/__tests__/QueryApi.test.ts`
- `packages/solid-pod-sync/src/__tests__/SyncEngine.test.ts`
- `packages/solid-pod-sync/src/__tests__/DocustreamAggregation.test.ts`
- `packages/solid-pod-sync/src/index.ts` (exports)
- `packages/mobile-app/app/feed.tsx` (retrieval merge + dedupe integration)
- `packages/mobile-app/app/docustream.tsx` (query-driven source filtering)
- `packages/mobile-app/src/solid/syncCheckpointStore.ts` (AsyncStorage checkpoint persistence with multi-surface scope keys)
- `packages/solid-pod-sync/src/adapters/MashlibWebAdapter.ts` (web-only adapter boundary scaffold)
- `packages/solid-pod-sync/src/__tests__/MashlibWebAdapter.test.ts` (boundary behavior tests)
- `packages/mobile-app/src/solid/mashlibWebAdapter.ts` (feature-gated web runtime adapter bridge)
- `packages/mobile-app/app.config.js` (`NZ_MASHLIB_EXPLORER_ENABLED` runtime flag)

Verification commands and outcomes:

1. `corepack pnpm --filter @nodezero/solid-pod-sync type-check`
- Outcome: PASS

2. `corepack pnpm --filter @nodezero/solid-pod-sync test`
- Outcome: PASS
- Evidence summary: 7 suites passed, 42 tests passed, snapshots passed

3. `corepack pnpm --filter @nodezero/mobile-app type-check`
- Outcome: PASS

4. `corepack pnpm --filter @nodezero/solid-pod-sync test -- DocustreamAggregation.test.ts QueryApi.test.ts SyncEngine.test.ts`
- Outcome: PASS
- Evidence summary: 3 suites passed, 9 tests passed

5. `corepack pnpm --filter @nodezero/solid-pod-sync test -- SyncEngine.test.ts DocustreamAggregation.test.ts`
- Outcome: PASS
- Evidence summary: 2 suites passed, 7 tests passed

6. `corepack pnpm --filter @nodezero/solid-pod-sync test -- MashlibWebAdapter.test.ts SyncEngine.test.ts`
- Outcome: PASS
- Evidence summary: 2 suites passed, 8 tests passed

7. `corepack pnpm --filter @nodezero/solid-pod-sync test -- MashlibWebAdapter.test.ts`
- Outcome: PASS
- Evidence summary: 1 suite passed, 4 tests passed

8. `corepack pnpm --filter @nodezero/mobile-app type-check`
- Outcome: PASS
- Evidence summary: mashlib web adapter bridge integration compiles cleanly

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

1. Sync checkpoint persistence is now in place for feed and docustream retrieval paths, but broader ingestion/replay persistence strategy remains to be generalized across all retrieval surfaces.
2. Layer 5 adapter now includes concrete resource-type inference and pane binding normalization with a web runtime bridge in app surfaces, but real mashlib pane-package loading in staging remains pending.
3. Staging runtime verification should be expanded from command/test checks to a scripted end-to-end smoke flow.

## Next execution slice

1. Generalize checkpoint/replay handling beyond feed/docustream into any additional query surfaces that adopt Layer 4 state.
2. Validate real mashlib pane-package loading in staging web (beyond the current global runtime bridge) and confirm pane availability against live pod resources.
3. Add one staging smoke script that toggles bootstrap and verifies container + ACL outcomes against a test Pod.
