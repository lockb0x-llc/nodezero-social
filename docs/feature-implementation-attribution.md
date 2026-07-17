# Feature Implementation Progress and Upstream Attribution

Status date: 2026-07-05
Scope: Solid ecosystem integrations, Mashlib boundary work, and related dependency usage in NodeZero Social.

This document records:

1. Actual implementation progress in this repository.
2. Upstream projects/libraries used by each feature area.
3. Why each upstream dependency is used.
4. Attribution links to acknowledge original contributors and maintainers.

## Attribution policy

- Use upstream projects as dependencies/adapters without copying project branding or implying endorsement.
- Keep core domain logic in NodeZero-owned packages where required by ADR boundaries.
- Document upstream references whenever behavior or architecture is shaped by external libraries/specs.

## Feature progress and attributions

| Feature area | Status | NodeZero implementation references | Upstream project/library | Why this dependency/project is used | Upstream attribution |
|---|---|---|---|---|---|
| Internal NodeZero session sign-in (web) | Live on staging | `packages/mobile-app/src/contexts/NodeZeroSessionContext.tsx`, `packages/jss-provisioner/src/index.ts` | NodeZero provisioner + Pod proxy contract | Passwordless challenge-sign flow with fail-closed session issuance and proxied Pod access. | https://github.com/nodezero-social/nodezero-social |
| Pod profile and social graph read/write | Live baseline | `packages/solid-pod-sync/src/ProfileManager.ts`, `packages/solid-pod-sync/src/SocialGraph.ts`, `packages/solid-pod-sync/package.json` | `@inrupt/solid-client` | Solid Pod data access primitives and authenticated RDF resource operations. | https://github.com/inrupt/solid-client-js |
| Server-side Solid session compatibility | Implemented in package contract boundary | `packages/solid-pod-sync/src/ProfileManager.ts`, `packages/solid-pod-sync/src/SocialGraph.ts`, `packages/solid-pod-sync/package.json` | `@inrupt/solid-client-authn-node` (peer) | Supports node-runtime Solid session interoperability without hard-coupling package runtime. | https://github.com/inrupt/solid-client-js/tree/main/packages/node |
| Node Zero Community Server (self-hosted Solid server) | Live on staging | `infrastructure/azure/solid-server.bicep`, `docs/staging-runtime-implementation-roadmap.md` | Community Solid Server | Provides hosted Solid Pod + OIDC server foundation for NodeZero-owned issuer path. | https://github.com/CommunitySolidServer/CommunitySolidServer |
| Docustream source management + RSS ingest | Live in app | `packages/mobile-app/app/docustream.tsx`, `packages/solid-pod-sync/src/DocustreamManager.ts`, `docs/staging-runtime-implementation-roadmap.md` | Solid protocol data model + internal sync/query layers | Persists source registry and ingested feed entries in user Pod-owned data surfaces. | https://solidproject.org/ |
| Mashlib adapter boundary (web explorer panes) | Implemented baseline (feature-gated) | `packages/solid-pod-sync/src/adapters/MashlibWebAdapter.ts`, `packages/mobile-app/src/solid/mashlibWebAdapter.ts`, `packages/mobile-app/src/solid/mashlibPaneProvider.ts`, `docs/adrs/data-backpack-docustream/ADR-004-mashlib-boundary.md` | Mashlib (SolidOS ecosystem) architecture reference | Enables optional web explorer pane semantics while preserving ADR boundary: core remains mashlib-independent. | https://github.com/solid/mashlib |
| Mashlib runtime flags and staging proofs | In progress (runtime/deployed proofs implemented; authenticated pane evidence still tracked) | `packages/mobile-app/app.config.js`, `packages/mobile-app/app/_layout.tsx`, `docs/data-backpack-docustream-implementation-status.md`, `docs/data-backpack-docustream-weekly-execution-tracker.md` | Mashlib-inspired web pane model and SolidOS conventions | Controlled rollout using feature flags and evidence-driven staging checks before wider enablement. | https://github.com/solid/mashlib |

## Important clarification on Mashlib usage in this repository

Current state in code:

- NodeZero does not currently import the `mashlib` npm package directly in production runtime paths.
- NodeZero implements a web-only adapter boundary and first-party pane provider contract (`nodezero:mashlib-pane-provider`) to remain compatible with mashlib-style pane semantics.
- This is intentional per ADR-004 to avoid coupling core domain/persistence/sync logic to a single UI library.

Primary references:

- `docs/adrs/data-backpack-docustream/ADR-004-mashlib-boundary.md`
- `packages/solid-pod-sync/src/adapters/MashlibWebAdapter.ts`
- `packages/mobile-app/src/solid/mashlibWebAdapter.ts`

## Related standards and ecosystem acknowledgements

- Solid specifications and ecosystem guidance: https://solidproject.org/
- RDF and linked-data foundations used by Solid ecosystem tooling: https://www.w3.org/RDF/
- Stellar Soroban platform used for NodeZero identity anchoring: https://developers.stellar.org/docs/smart-contracts

## Maintenance checklist

When introducing or changing a third-party dependency for identity, Pod sync, linked data, or explorer UI:

1. Update this file with status, implementation references, and attribution links.
2. Update `README.md` and wiki references if user-visible behavior changes.
3. Confirm ADR alignment when the change touches integration boundaries.
4. Re-run relevant verification scripts referenced in `docs/staging-runtime-implementation-roadmap.md`.
