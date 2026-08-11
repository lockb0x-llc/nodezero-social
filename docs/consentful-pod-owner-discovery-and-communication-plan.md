# Consentful Pod-Owner Discovery and Communication Plan

Milestone: Q  
Status: Approved for implementation  
Start date: 2026-07-31  
Environment: `staging-testnet`  
Production Mainnet: Out of scope

## Objective

Deliver a complete, consentful social loop in which a Pod owner can explicitly become
discoverable, another user can understand why they were discovered, the users can
establish a reciprocal relationship, and accepted participants can communicate while
retaining immediate disconnect, mute, block, and discovery-revocation controls.

## Architecture Invariants

- Solid Pods are authoritative for consent, relationship, moderation, inbox, and
  durable notification state.
- The Community Directory is a rebuildable projection of explicitly public manifests.
- Waku is the ephemeral nearby and low-latency plane, not relationship authority.
- Listing, public indexing, nearby presence, identity reveal, contact requests, and
  broadcast participation are independent.
- Accepted and unblocked relationships are required for directed audiences, except for
  an explicit mutual nearby reveal flow.
- Private interests, Trust Circles, block lists, location history, reveal history, and
  communication activity are never indexed.
- Full ActivityPub and AT Protocol adoption are excluded.
- Internal-only authentication and environment isolation remain unchanged.

## Work Breakdown

| ID  | Owner                          | Depends on              | Deliverable                                                                                                           | Status                                                                                                                             |
| --- | ------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Q0  | Project Manager and Docs Agent | None                    | Canonical system description, ADR, architecture updates, agent instructions, PM board, and baseline evidence          | Complete                                                                                                                           |
| Q1A | Solid Data Agent               | Q0                      | Versioned contracts, Pod layout, discovery, relationship, moderation, Type Index, and compatibility managers          | Complete: superseded package evidence is recorded under Q2                                                                         |
| Q1B | Solid Integration Specialist   | Q0, shared Q1 contracts | LDN and WebID discovery adapters, credential-free remote fetch, Pod proxy constraints, and inbox delivery             | Complete: Solid 20 suites/114 tests and provisioner 88/88 tests pass                                                               |
| Q1C | Audit Agent                    | Q0                      | Threat model and security test vectors for ACL, SSRF, replay, privacy, migration, and block precedence                | Complete: 22 executable vectors across 10 categories pass; Audit Agent GO                                                          |
| Q2  | Solid Data Agent               | Q1A, Q1B                | Relationship lifecycle, replay ledger, legacy migration, moderation, and `foaf:knows` projection                      | Complete: Solid 168, mobile 90, and provisioner 101 tests pass; strict staging PWA artifact passes                                 |
| Q3A | Azure Platform Agent           | Q1 contracts, P6        | Durable derived index, feature flags, telemetry, slots/revisions, rollback assets, and staging deployment wiring      | Complete locally: Azure/Audit GO; retained-artifact rollback substitutes for unavailable B1 slots; Q4 deployment/rehearsal pending |
| Q3B | Mobile App Agent               | Q2, Q3A API contract    | Consent controls, public-interest selection, explainable recommendations, and unified Directory/Profile/Local actions | Complete locally: independent Mobile and Audit GO; deployment validation pending Q3A/Q4                                            |
| Q3C | P2P Relay Agent                | Q1 contracts            | Presence, reveal, Waku, WebRTC, and relay consent/block enforcement plus abuse controls                               | Complete locally: independent Mobile and Audit GO; deployment configuration and Q4 journeys pending                                |
| Q4  | QA Release Agent               | Q1-Q3                   | Package, integration, browser, device, deployment, rollback, and soak evidence                                        | In progress: exact-SHA staging deployment is the current blocker                                                                   |
| Q5  | Docs Agent                     | Q4 and Audit GO         | Validated Wiki/status updates and Milestone Q release evidence                                                        | Not started                                                                                                                        |

## Phase 0: Documentation And Governance

1. Establish the documentation authority model:
   - `docs/system-description.md` describes purpose, trust posture, capability state,
     target experience, and scope.
   - `docs/architecture.md` owns component boundaries, flows, and threats.
   - The Milestone Q ADR owns the durable decision.
   - This document owns execution status, gates, and evidence.
2. Align README, deployment, roadmap, UAT, environment, attribution, and Wiki summaries.
3. Synchronize repository-wide instructions and specialist role cards.
4. Replace stale PM assignments with Q-series work and reconcile P4, P6, and P7.
5. Capture the current `testnet` SHA, latest successful staging workflow, deploy marker,
   API provenance, directory behavior, and Waku/relay revision.

Exit gate: all documentation and agent artifacts use the same consent vocabulary and
do not describe target behavior as already shipped.

## Phase 1: Contracts And Secure Transport

1. Add discovery, relationship, moderation, receipt, and replay contracts and fixtures.
2. Add strict ActivityStreams relationship parsing and serialization.
3. Add Pod managers and extend the default Pod layout.
4. Implement public Type Index registration and WebID link discovery.
5. Implement owner-controlled, public append-only LDN inbox ACLs.
6. Constrain Pod proxy operations to the authenticated session and expected Pod.
7. Add an HTTPS-only, credential-free, SSRF-safe public discovery/delivery fetch path.
8. Replace per-recipient sender-outbox writes with one outbox activity and explicit
   recipient inbox delivery.

Exit gate: round-trip, ACL, ETag, conflict, replay, external credential, and SSRF tests
pass with no feature enabled for users.

## Phase 2: Relationships, Safety, And Migration

1. Implement pending, accepted, rejected, cancelled, disconnected, muted, and blocked
   behavior with idempotent transitions.
2. Process inbox activities with sender verification, duplicate suppression, expiry,
   limits, quarantine, and delivery receipts.
3. Project accepted relationships to `foaf:knows` without replacing unknown graph data.
4. Lazily migrate existing `foaf:knows` values to `legacy-connected` records.
5. Add private mute, block, and report state.
6. Require accepted and unblocked relationship state for all directed compose
   audiences, including Trust Circle.

Exit gate: transition, migration, malformed activity, actor mismatch, block precedence,
and recipient-policy suites pass.

### Q2 implementation evidence (2026-08-01)

Implemented:

- Private relationship outbox, delivery-receipt, replay, moderation, relationship,
  quarantine, and compatibility-projection stores.
- Compact ActivityStreams `Follow`, `Accept`, `Reject`, and correlated `Undo`
  persistence and authenticated provisioner delivery.
- Pending, delivered, and failed receipt updates without giving the external delivery
  boundary Pod credentials.
- Replay suppression, stale/future rejection, actor/recipient correlation, block
  precedence, and private quarantine for malformed or unverifiable activities.
- Lazy `foaf:knows` import as `legacy-connected`; accepted-only compatibility
  projection; disconnect removes only NodeZero-owned `foaf:knows` values and preserves
  unrelated RDF.
- Directed compose recipients now require accepted and unblocked relationship state;
  Trust Circle membership only narrows that eligible set.
- Existing Directory/Profile connection actions now create a durable relationship
  request instead of unilaterally granting consent through `foaf:knows`.
- Recipient-bound short-lived delivery assertions use a dedicated provisioner signing
  key, payload digest, recipient, actor, activity ID, issuer, and expiry. The recipient
  verifies them through an authenticated endpoint; no session or Pod credential is
  written to the inbox.
- Pod-authoritative inbound-request consent defaults off. When explicitly enabled,
  bounded direct-child inbox reads verify assertions, apply replay-safe transitions,
  quarantine rejected payloads, and remove handled inbox resources.
- Profile exposes request consent, refresh, Accept, and Reject actions. Failed pending
  requests retry the original immutable Follow rather than minting a second request.

Validation:

- `@nodezero/solid-pod-sync`: 31 suites, 168 tests pass; build/type-check pass; lint
  has zero errors and one pre-existing warning in `NsfwDecision.test.ts`.
- `@nodezero/mobile-app`: 90 tests pass; type-check and touched-file lint pass; strict
  `staging-testnet` web export and `pwa:validate:artifact` pass.
- `@nodezero/jss-provisioner`: 101 tests pass; type-check and touched-file lint pass.
- `pnpm policy:validate-consentful-discovery` passes 22 versioned vectors across
  inbox ACL, inbox flood, rate limiting, SSRF, credential isolation, replay,
  sender verification, privacy, migration, and block-precedence categories.
- `pnpm policy:validate-env` and `git diff --check` pass.
- Full mobile source lint remains blocked by unrelated pre-existing diagnostics in
  `app/index.tsx` and `src/contexts/WalletContext.tsx`.

Q1C and Q2 are complete locally with Audit Agent GO. The security gate includes
actor-bound, ETag-fenced replay leases; adversarial chunked inbox cancellation;
retry-safe transient failures; complete embedded-private IPv6 denial; server-side
owner block policy; runtime public-manifest sanitation; and route-level rate limits.
No staging deployment or release certification was performed in Q1C/Q2.

## Phase 3: Discovery And Recommendations

1. Add default-off controls for public directory listing, public profile indexing,
   nearby presence, inbound contact requests, and local broadcast participation.
2. Add explicit public-interest selection separate from private Backpack interests.
3. Replace internal-key listing mutation with a session-authenticated manifest refresh.
4. Persist only validated public manifest fields, source revision, publication timestamp,
   expiry, and index provenance in the derived directory.
5. Add pagination, cache validators, tombstones, immediate opt-out, rate limits, and
   reconciliation.
6. Add client-side explainable recommendations with stable reason codes.
7. Wire serendipity and deep-ties controls to documented deterministic weights.

Exit gate: default-off, own mutation, cross-user denial, removal latency, public/private
interest separation, pagination, and recommendation-reason suites pass.

### Q3A API contract evidence (2026-08-01)

- `POST /v1/community-directory/refresh` derives the owner exclusively from a valid
  NodeZero session and reads private Pod consent before any public manifest read.
- Legacy internal-key `opt-in`/`opt-out` routes return `410`; callers cannot supply a
  target WebID to the refresh route.
- The derived record stores only allowlisted manifest fields plus publication timestamp,
  manifest URL, expiry, and source revision. Invalid, missing, expired, or opted-out
  manifests clear prior public fields immediately.
- Public index pages are bounded to 100 records, use stable WebID cursors and weak
  ETags, and never expose internal removal tombstones or always-private records.
- Focused directory projection/refresh/route tests pass 18/18; full provisioner tests
  pass 113/113; Q1C 22-vector and environment-isolation policies pass.
- At the time recorded, this was API-contract evidence only. The durable platform
  implementation completed locally on 2026-08-02 as recorded below; deployed
  provenance and rehearsal remain Q4 work.

### Q3A publication hardening amendment (2026-08-09)

- Publication and cleanup are generation-fenced and replay-safe: NodeZero manifests and
  Type Index registrations bind to a publication-only generation reserved before artifact
  inputs are read, so delayed writers cannot downgrade public data. The generation does not
  reveal unrelated private-consent churn.
- Existing RDF resources require an HTTP `ETag`; writes use `If-Match`, first creation uses
  `If-None-Match: *`. The staging-testnet v4 clean cutover abandons generationless test
  artifacts: full opt-out may remove only the exact representation observed under a strong
  `ETag`. Cleanup still preserves newer or concurrently replaced artifacts.
- Listing and indexing remain independent. Listing-only opt-out retains public artifacts
  only when Pod consent explicitly keeps indexing enabled; full opt-out removes the
  manifest and NodeZero Type Registration.
- Opt-out suppresses the derived projection before public artifact cleanup. Every
  destructive phase re-reads Pod authority, and a mismatched first projection triggers
  bounded authoritative reconciliation before surfacing `pending-sync`.
- The internal Pod proxy enforces generation plus `If-Match`/`If-None-Match` on protected
  publication mutations. Durable suppression tombstones prevent same- or older-generation
  refreshes from re-listing an opted-out owner while allowing incomplete same-generation
  publication to finish.
- The provisioner uses `sparqljs` only for bounded profile-update classification. Replace
  the deprecated parser with a maintained SPARQL 1.1 parser before Directory rollout expands
  beyond the approved staging cohort.
- Directory responses contain only WebID, display name, avatar URL, and explicitly selected
  public recommendation fields. Pod location and projection provenance remain internal.

### Q3A local platform evidence (2026-08-02)

- The derived Directory uses a partition-isolated Azure Table backend with hashed
  row keys, ETag-fenced monotonic writes, equal-time opt-out precedence, bounded
  scans, targeted mutation reads, active read/write/delete readiness, and immediate
  in-process suppression of observed opt-outs even when persistence fails.
- Rollout controls default Directory, peer Profile, relationship, and transport
  features off. Enabled features require keyed cohort HMAC membership. Telemetry
  emits aggregate feature/outcome counters without WebIDs, interests, blocks, H3
  cells, relationship payloads, or message content.
- The staging workflow packages and verifies provisioner, relay, and PWA artifacts
  from one commit, requires stable session/relationship/transport keys, proves Table
  readiness, retains a digest-bound rollback bundle for 90 days, and keeps all Q
  feature flags dark.
- The guarded rollback workflow authenticates the exact successful source workflow,
  run attempt, branch, and commit; validates all artifact digests; clean-deploys the
  retained provisioner and relay; verifies every retained PWA asset live; and reports
  partial component outcomes without claiming unconditional success.
- The current App Service plan is Basic B1 and does not support deployment slots.
  Retained-artifact rollback is the accepted local Q3A mechanism. Slot adoption or a
  paid SKU change remains P6 work and requires explicit approval.
- Validation: provisioner 136/136, relay 3/3, adversarial opt-out 2/2, consent policy
  22/22, touched type/lint, environment/PWA policy, both workflow YAML files, rollback
  digest relocation, and diff hygiene pass. Azure Platform Agent and Audit Agent
  issued local Q3A GO.
- No Q3A deployment or rollback rehearsal has occurred. Local `testnet` is ahead of
  `origin/testnet`; the latest successful staging workflow and deploy marker remain
  commit `5d0d3532ba4d1e035c141dd9f4dbf8f751dea5b9`. Deployment provenance,
  zero-retry two-account/device journeys, rollback rehearsal, and soak are Q4 gates.

### Q3B/Q3C local implementation evidence (2026-08-01)

- Discovery preferences persist independent listing, indexing, nearby-presence,
  local-broadcast, and selected-interest choices. Three-way merging prevents a
  stale device from restoring a fresher cross-device opt-out.
- Directory, Profile, and Local share relationship, Trust Circle, mute, block,
  and report policy. Incoming requests expose Accept/Decline, outgoing requests
  expose Cancel, and only accepted/unblocked relationships can message.
- Peer Profile reads use the authenticated provisioner route and a credential-free,
  SSRF-resistant server fetch; NodeZero bearer credentials remain exact-origin.
- Waku envelopes bind opaque provisioner assertions inside Stellar signatures.
  Presence aliases are derived from the authenticated account and checked against
  beacon commitments. Relay admission additionally requires a one-time nonce signed
  by the assertion-bound Stellar key before registration or replacement.
- Consent and relationship state reconcile from the Pod, block state purges rendered
  messages/reveals immediately in-process, and local disconnect takes effect before
  best-effort remote notification.
- Local validation: mobile 119/119, provisioner 119/119, Waku 55/55, relay 3/3;
  touched lint and five package type-checks pass; consent security 22/22, environment,
  PWA policy, strict staging-profile build, artifact validation, and diff checks pass.
  Mobile App Agent and Audit Agent issued local-code GO.
- This is not deployment or release GO. Q3A platform implementation is complete
  locally; staging must now obtain successful matching workflow provenance,
  zero-retry two-account journeys, rollback evidence, and soak results under Q4.

## Phase 4: Integrated Social Experience

1. Introduce shared person, relationship-view, and action services.
2. Make Directory entries open peer profiles and show request and safety state.
3. Add Request, Accept, Decline, Cancel, Disconnect, Message, Trust Circle, Mute,
   Block, and Report actions to the shared surface.
4. Use the same actions after a mutual nearby reveal.
5. Apply one safety context before every Solid, Waku, WebRTC, compose, and rendering
   path.
6. Store durable social events and unread state in Pods while keeping Waku low latency.
7. Add in-app social notifications only after durable inbox processing works. Email
   remains disabled without separate channel consent.

Exit gate: two users complete discovery, request, acceptance, and conversation; reject,
cancel, block, and revoke paths are immediate and consistent across screens.

## Phase 5: CI, Infrastructure, And QA

1. Add durable stores, default-off flags, privacy-safe telemetry, and retained deployment
   slots/revisions to Azure IaC and staging workflow.
2. Add `policy:validate-consentful-discovery`.
3. Add `qa:smoke:consentful-discovery` without expanding the identity-only auth gate.
4. Add zero-retry two-account Playwright journeys and physical mobile cases.
5. Add Waku, P2P, and relay tests for identity binding, replay, TTL, consent, block,
   reconnect, rate, size, and connection limits.
6. Make staging deployment depend on completed validation jobs.
7. Extend UAT with separate consent, relationship, safety, nearby, communication, and
   revocation case IDs.

Exit gate: package, workspace, contract, policy, browser, relay, Bicep, and what-if
checks pass before deployment.

## Phase 6: Staging Rollout And Release Evidence

1. Deploy additive backend and infrastructure changes with all Q flags off.
2. Lazily create or repair Pod resources after authenticated sign-in; do not auto-list
   existing users.
3. Enable a bounded Testnet cohort in this order:
   - directory controls;
   - relationship requests;
   - safety controls;
   - explainable recommendations;
   - nearby presence and reveal;
   - DMs and local broadcasts;
   - in-app notifications.
4. Run exact-SHA smoke, auth, lockb0x audit, DocuStream regression, desktop browsers,
   physical devices, drift checks, and data reconciliation after each stage.
5. Rehearse frontend artifact, provisioner slot, and Waku/relay revision rollback.
6. Soak for 24 hours or one complete relevant expiry interval.
7. Require explicit Project Manager, QA Release Agent, and Audit Agent GO decisions.

Exit gate: the latest workflow succeeds, deployed provenance matches, rollback and
forward restoration pass, opted-out users remain absent, no P0/P1 remains, and a new
Milestone Q evidence summary records only validated behavior.

## Required Validation

Focused checks are required for every touched package. The final pre-deploy gate is:

```powershell
corepack pnpm prepare:zk:test-artifacts
corepack pnpm lint
corepack pnpm type-check
corepack pnpm test
corepack pnpm test:contracts
corepack pnpm policy:validate-env
corepack pnpm policy:validate-attestation-fail-closed
corepack pnpm policy:validate-docustream-enabled
corepack pnpm policy:validate-pwa
corepack pnpm policy:validate-consentful-discovery
corepack pnpm test:e2e -- --retries=0
corepack pnpm qa:smoke:consentful-discovery
corepack pnpm qa:smoke:auth
corepack pnpm qa:audit:lockbox
corepack pnpm qa:smoke:docustream-pane
```

## Rollback Policy

1. Disable DMs and local broadcast, then nearby presence, relationship delivery,
   recommendations, and directory publication.
2. Preserve private consent, relationship, and safety records.
3. Never recreate a public listing during rollback.
4. Redeploy the retained N-1 frontend artifact, swap to the verified N-1 provisioner
   slot, and route Waku/relay to the previous healthy revision.
5. Verify workflow success, provenance, auth, Pod access, environment isolation,
   directory absence, block precedence, feed, and DocuStream after rollback and
   forward restoration.

## Deliberate Exclusions

- Full ActivityPub, WebFinger, shared inbox, and global content federation.
- AT Protocol repositories, relays, AppViews, or label protocol.
- Inferred consent or automatic publication of existing accounts and interests.
- Production Mainnet deployment.
- Broad feed-ranking redesign.
- Email social notifications without a separate consent design and security review.
