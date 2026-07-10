# Data Backpack + DocuStream Implementation Status

Status date: 2026-07-09
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
- `packages/mobile-app/src/solid/mashlibPaneProvider.ts` (first-party pane runtime payload for web bridge)
- `packages/mobile-app/app.config.js` (`NZ_MASHLIB_EXPLORER_ENABLED` and `NZ_MASHLIB_MODULE_ID` runtime flags)
- `packages/mobile-app/app/_layout.tsx` (web runtime injection of `__NZ_MASHLIB__` when explorer enabled)

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

9. `corepack pnpm qa:smoke:solid-bootstrap` (config resolution stage)
- Outcome: PASS for app.config verification stage
- Evidence summary: staging profile resolves `mashlibExplorerEnabled` and `mashlibModuleId` fields in addition to bootstrap/issuer checks

10. `node -e "const cfg=require('./packages/mobile-app/app.config.js'); ..."` with `NZ_MASHLIB_EXPLORER_ENABLED=true`
- Outcome: PASS
- Evidence summary: staging config resolves `mashlibExplorerEnabled: true` with module-id field present, enabling web runtime payload injection path

11. `corepack pnpm qa:smoke:mashlib-runtime`
- Outcome: PASS
- Evidence summary: focused runtime proof confirms staging config resolves `mashlibModuleId: nodezero:mashlib-pane-provider` with explorer enabled, and adapter test verifies bound pane labels are populated for docustream resources

12. `corepack pnpm qa:smoke:mashlib-deployed`
- Outcome: PASS (against `https://staging.nodezero.social`)
- Evidence summary: deployed staging bundle includes `nodezero:mashlib-pane-provider` sentinel and pane/render markers after direct Static Web App deployment of a staging-profile artifact

13. `bash ./scripts/qa/staging-mashlib-deployed-proof.sh --bundle-file /mnt/c/Users/standarduser/Code/nodezero-social/packages/mobile-app/dist/_expo/static/js/web/index-21303f0b828e796f8a81333b2a02de28.js`
- Outcome: PASS
- Evidence summary: locally exported web artifact (built with `NZ_ENV_PROFILE=staging-testnet`, `NZ_MASHLIB_EXPLORER_ENABLED=true`, `NZ_MASHLIB_MODULE_ID=nodezero:mashlib-pane-provider`) contains module-id sentinel and pane label/render markers (`Activity Stream`, `Timeline View`, `Web explorer panes`)

14. `npx @azure/static-web-apps-cli@2.0.2 deploy ./packages/mobile-app/dist --deployment-token <token> --env production` then `corepack pnpm qa:smoke:mashlib-deployed`
- Outcome: PASS
- Evidence summary: manual SWA deployment completed successfully (deployment id `eac2bdbb-0e20-4d2f-807e-0380a1ed223c`) and live staging proof immediately passed

15. `corepack pnpm qa:smoke:docustream-pane` (seeded-session deterministic mode)
- Outcome: FAIL
- Evidence summary: runtime app config loaded on staging reports `envProfile: staging-testnet` but `mashlibExplorerEnabled` and `mashlibModuleId` are `null`, so web adapter pane hints cannot render on docustream despite bundle marker presence

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

  ## 2026-07-09 stabilization update (Docustream retrieval + auth continuity)

  Stabilization scope completed for staging Docustream reliability, focused on
  session continuity during OIDC restore and Pod listing compatibility.

  Implemented/updated files:

  - `packages/solid-pod-sync/src/DocustreamManager.ts`
  - `packages/solid-pod-sync/src/DocustreamSourceManager.ts`
  - `packages/mobile-app/src/contexts/SolidContext.tsx`
  - `packages/mobile-app/app/_layout.tsx`
  - `packages/mobile-app/app/index.tsx`
  - `packages/mobile-app/app/docustream.tsx`
  - `scripts/qa/staging-docustream-pane-evidence.mjs`

  Behavioral outcomes:

  1. Pod container listing parse compatibility now supports JSON-LD payloads and
    Turtle fallback, preventing false-empty stream results after ingest.
  2. Source write failures now surface auth/status diagnostics (`HTTP`,
    `www-authenticate`, response snippet) for faster triage.
  3. Mobile/web auth flow preserves WebID continuity through node-session fallback
    while OIDC session restoration settles, reducing route churn and avoiding
    dead "restoring" states on Docustream operations.
  4. Source modal interaction and add flow now support explicit re-auth
    initiation when write authorization is missing/expired.

  Verification commands and outcomes:

  1. `corepack pnpm --filter @nodezero/solid-pod-sync type-check`
    - Outcome: PASS

  2. `corepack pnpm --filter @nodezero/solid-pod-sync test -- src/__tests__/new-features.test.ts`
    - Outcome: PASS
    - Evidence summary: 1 suite passed, 10 tests passed

  3. `corepack pnpm --filter @nodezero/mobile-app type-check`
    - Outcome: PASS

  4. `node --check scripts/qa/staging-docustream-pane-evidence.mjs`
    - Outcome: PASS

## Remaining implementation gaps

1. Sync checkpoint persistence is now in place for feed and docustream retrieval paths, but broader ingestion/replay persistence strategy remains to be generalized across all retrieval surfaces.
2. Layer 5 adapter now includes concrete resource-type inference, pane binding normalization, runtime module-resolution bridge, first-party web payload injection, focused runtime proof checks, and deployed-artifact proof script with live staging bundle-marker PASS evidence.
3. Authenticated UI-level pane evidence is currently blocked in staging because deployed runtime config is missing `mashlibExplorerEnabled`/`mashlibModuleId` at runtime; a fresh deploy with those flags active is required.

## Next execution slice

1. Generalize checkpoint/replay handling beyond feed/docustream into any additional query surfaces that adopt Layer 4 state.
2. Re-deploy staging web artifact from workflow/build path that emits `extra.mashlibExplorerEnabled=true` and `extra.mashlibModuleId=nodezero:mashlib-pane-provider`, then re-run `qa:smoke:docustream-pane`.
3. Add one staging smoke script that toggles bootstrap and verifies container + ACL outcomes against a test Pod.
