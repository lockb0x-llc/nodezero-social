# Milestone Q Delta Release Runbook

Date prepared: 2026-08-02
Target branch: `testnet`
Target environment: `staging-testnet`
Release type: additive Testnet delta, all Milestone Q feature flags dark by default

## Release Objective

Deploy the reviewed Milestone Q delta without enabling discovery or communication
for the general staging population. Certify exact deployed provenance, retained
rollback artifacts, and manual two-account mobile behavior before any cohort is
enabled.

This runbook does not authorize Production Mainnet deployment.

## Current Boundary

- Local Q3A/Q3B/Q3C implementation has Azure, Mobile, and Audit GO.
- The latest accepted staging marker is still commit
  `5d0d3532ba4d1e035c141dd9f4dbf8f751dea5b9`.
- `testnet` must be clean and exactly synchronized with `origin/testnet` before the
  candidate workflow is dispatched.
- The App Service plan is Basic B1. Deployment slots are unavailable. The approved
  rollback mechanism is the retained exact-SHA artifact workflow.
- Milestone Q flags must remain false during initial deployment and rollback:
  `directory`, `peer-profile`, `relationship`, and `transport`.

## Blocking Strategy

| Blocker               | Required repair/evidence                                                                          | Owner                  | Release stop                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| Candidate provenance  | Commit all reviewed changes, push `testnet`, and run `pnpm qa:q4:candidate`                       | Project Manager        | Candidate SHA differs from `origin/testnet` or worktree is dirty                         |
| Deployment provenance | Successful `staging-deploy.yml` for the exact candidate SHA and matching live marker              | Azure Platform + QA    | Workflow failure, stale marker, backend payload mismatch, or flags not dark              |
| Durable Directory     | Health reports Azure Table backend ready; opt-out race tests and consent policy pass              | Azure Platform + Audit | Table readiness false, stale opt-in, failed opt-out visibility, or private data exposure |
| Relay identity        | Relay health reports verifier reachable and transport dark; exact relay payload matches candidate | P2P Relay + Audit      | Old relay payload, verifier unreachable, or transport unexpectedly enabled               |
| Rollback              | Retained bundle exists for source run/attempt; rollback and forward restoration both pass         | Azure Platform + QA    | Missing artifact, digest mismatch, partial component failure, or opt-out restoration     |
| Two-account behavior  | Zero-retry User A/User B journeys pass on physical iOS and Android                                | QA Release             | Any retry, identity reuse, block bypass, or directed message before acceptance           |
| Observation           | 24-hour soak or one complete relevant expiry interval with no severity-1/2 regression             | QA Release + Audit     | Auth, Pod, Directory, relay, privacy, or provenance regression                           |

## Phase 1: Local Preparation

1. Confirm no unreviewed files are present:
   ```powershell
   git status --short
   git diff --check
   ```
2. Run the local preparation gate:
   ```powershell
   pnpm qa:q4:preflight
   ```
   This includes a clean, lockfile-driven provisioner `pnpm deploy` build, exact
   runtime-version checks, Solid package loading, and a zero-vulnerability production
   closure audit. The server keeps only its dependency-free canonical claim serializer
   locally instead of shipping the full proof-generation workspace. The packaged
   startup script also pins and verifies the official Stellar CLI archive SHA-256 before
   extracting or executing it.
   The App Service ZIP is assembled from a committed npm runtime lock into real files
   under `dist/node_modules`, exposes no root Node project, and deploys with
   `--ignore-stack true` so Kudu does not run NodeProjectOptimizer on ready-to-run bytes.
   Provisioner configuration must stabilize through three consecutive authenticated
   Kudu deployment-API reads before an asynchronous, no-restart copy; candidate
   provenance settings are activated only after Kudu reports terminal success,
   producing the single intended application restart. Transient SCM status
   failures are retried within the bounded polling window, and terminal failure or
   timeout emits the distinct Kudu deployment record and log before failing closed.
   After provenance activation, allow up to ten minutes for App Service startup and
   dependent readiness, while still requiring three consecutive all-dark health
   samples and a final 30-second exact-commit hold before later components mutate.
   Relay configuration follows the same restart-safe boundary: three authenticated
   Kudu deployment-API reads, asynchronous no-restart byte copy, terminal Kudu
   success, one explicit activation restart, then exact relay health and provenance.
   The relay artifact uses a committed npm runtime lock and a flat, link-free closure
   under `dist`; the artifact root exposes no Node project for Kudu to optimize.
   App Service probes `/healthz` for process liveness, while the release gate retains
   `/health` for provisioner reachability, all-dark transport state, and provenance.
   The workspace production audit must report zero high and zero critical advisories;
   patched overrides are accepted only with package tests and a strict staging PWA build.
3. Review the complete delta from the last deployed tag through the final candidate
   SHA, including the release-preparation commit:
   ```powershell
   git log --oneline v0.2.0-testnet..HEAD
   git diff --stat v0.2.0-testnet..HEAD
   ```
4. Update `CHANGELOG.md` and this runbook if the candidate scope changes.
5. Commit the final release-preparation files. Do not squash away security or
   infrastructure provenance unless the resulting candidate is re-reviewed.

## Phase 2: Candidate Publication

1. Commit the reviewed release-preparation package locally.
2. Run the clean, pre-push candidate gate while `origin/testnet` is still the
   previously approved ancestor:
   ```powershell
   pnpm qa:q4:candidate
   ```
3. Push the reviewed `testnet` candidate. Pushes do not auto-deploy.
4. Verify authoritative publication:
   ```powershell
   pnpm qa:q4:published
   ```
5. Record:
   - candidate SHA;
   - push time;
   - reviewer approvals;
   - expected staging workflow run ID.
6. Stop if `origin/testnet` moves after candidate approval. Rebase/merge and rerun all
   candidate gates.

## Phase 3: Capture Genuine N-1 Baseline

1. Before deploying the Q candidate, dispatch the registered `staging-deploy.yml`
   workflow with `release_action=capture-baseline` and:
   - the exact commit in the current live staging marker;
   - explicit staging-testnet confirmation.
     The dispatcher calls `staging-baseline-capture.yml` as a reusable workflow because
     GitHub only exposes manual dispatch for workflows present on the default branch.
2. Require a successful `Staging Deploy` capture run whose
   `Capture authenticated live N-1` job passes and whose retained artifact is named
   `staging-baseline-<current-live-sha>`. The deploy job must be skipped.
3. Record the capture run ID, capture run attempt, capture tooling SHA, and baseline
   commit. The first Q deployment must supply all four values and fails closed if the
   live marker, source workflow, attempt, tooling SHA, manifest, or digests differ.
   A legacy relay without embedded build metadata is recorded separately as
   `kudu-deployment-tree`: its stable active Kudu deployment ID and complete file tree
   are authenticated without falsely assigning the PWA/provisioner marker commit to it.
   Provisioner runtime dependencies may be mutated by App Service startup, so its
   captured bytes are bound to stable before/after health identity, embedded build
   identity, the authenticated marker run, and two identical complete Kudu file-tree
   captures rather than by attempting to reconstruct its original pre-deploy payload
   digest from live files.
   Expo bundle hashes are not assumed reproducible from a later build. The active live
   service worker supplies a strict same-origin precache graph; Expo `registerAsset`
   metadata extends it with runtime fonts and images. Each referenced asset is fetched
   twice, all runtime references must resolve inside the retained tree, and the worker
   cache revision is recomputed from the exact precache bytes before retention.
   `staticwebapp.config.json` remains in the deployable rollback artifact but is excluded
   from the public HTTP checksum manifest because Static Web Apps consumes rather than
   serves that file.
   Retained baseline and rollback uploads include hidden path segments because Expo
   runtime assets can live under `.pnpm`; consumers reject any artifact missing a path
   listed in the PWA checksum manifest.
4. Do not use the candidate deployment's own rollback bundle as its N-1 artifact.

## Phase 4: Dark Staging Deployment

1. Manually dispatch `staging-deploy.yml` for the exact candidate SHA with
   `release_action=deploy`, explicit staging-testnet confirmation, and the successful
   baseline-capture run ID/attempt, baseline commit, and baseline tooling commit.
   For a disposable, never-production staging environment that cannot provide a coherent
   N-1 capture, use `release_action=clean-deploy` with explicit staging-testnet
   confirmation and no baseline inputs. This skips only N-1 authentication; every
   forward policy, build, infrastructure, dark-flag, health, marker, smoke, auth, and
   lockbox gate remains mandatory.
   Before the first cohort dispatch, run
   `pnpm qa:bootstrap:directory-cohort -- --apply` from an authenticated operator
   workstation. The command creates and immediately recovery-verifies two cohort
   accounts plus one non-cohort control before writing any GitHub environment secret.
   Set `directory_rollout=cohort` only after the `staging-testnet` environment contains
   `JSS_Q_COHORT_KEY`, exactly two comma-separated values in `JSS_Q_COHORT_HASHES`, and
   recovery bundles for account A, account B, and the non-cohort control:
   `NZ_DIRECTORY_ACCOUNT_A_RECOVERY_BUNDLE`,
   `NZ_DIRECTORY_ACCOUNT_B_RECOVERY_BUNDLE`, and
   `NZ_DIRECTORY_NON_COHORT_RECOVERY_BUNDLE`. Recovery bundles contain private wallet
   keys. Keep them only in GitHub environment secrets; the workflow materializes them
   with owner-only permissions in a trapped temporary directory, removes the raw
   environment values before browser execution, imports each into a fresh encrypted
   wallet, and mints a new browser session with a wallet-signed challenge. Cohort mode
   enables Directory only; peer Profile, relationship, and transport remain off.
2. Require successful blocking jobs:
   - environment isolation;
   - consentful discovery policy;
   - provisioner build/deploy/provenance;
   - relay build/deploy/provenance;
   - strict PWA build/artifact validation;
   - staging smoke;
   - identity-only `qa:smoke:auth`;
   - lockb0x state audit.
3. Verify the Directory flag matches `directory_rollout`; peer-profile, relationship,
   and transport must remain false.
4. Verify the live marker and successful workflow:
   ```powershell
   pnpm qa:q4:deployed
   ```
5. Confirm the retained artifact name is
   `staging-rollback-<candidate-sha>-<run-attempt>` and retention is 90 days.

## Phase 5: Dark-State Regression

Before enabling any cohort, verify:

- onboarding and returning sign-in still pass;
- Pod profile and DocuStream persistence still pass;
- Directory/peer-profile/relationship/transport routes are unavailable to users
  outside an approved keyed cohort;
- public health exposes readiness and flags but no raw identity, relationship,
  location, message, or cohort-counter data;
- no browser request contacts the CSS origin;
- staging remains Testnet-only.

## Phase 6: Approved Test Cohort

Configure only two test WebIDs using the keyed cohort HMAC mechanism. Never store raw
WebIDs in workflow files, app settings, telemetry, or evidence artifacts.

Requirements:

- User A and User B are distinct provisioned identities on separate device/browser
  profiles;
- a third distinct provisioned identity remains outside the cohort and proves the
  control path;
- both are explicitly included in the same approved test cohort;
- flags are enabled one at a time in this order:
  1. Directory;
  2. peer Profile;
  3. relationship;
  4. transport.
- after each flag, run the corresponding manual cases and inspect aggregate telemetry;
- any failure forces all Q flags off before investigation.

## Phase 7: Manual Mobile Device Matrix

Run every case with zero retries on at least one current physical iOS Safari/PWA lane
and one current physical Android Chrome/PWA lane. Use separate accounts/devices for A
and B.

| Case | Action                                           | Expected result                                                                                             | iOS | Android | Evidence notes |
| ---- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --- | ------- | -------------- |
| QD1  | Sign in without discovery changes                | Listing, indexing, presence, inbound requests, and broadcasts remain off                                    | —   | —       |                |
| QD2  | A enables listing only                           | A appears with minimal fields; private interests remain absent                                              | —   | —       |                |
| QD3  | A enables indexing without listing               | Selected metadata can publish, but A remains absent from Directory membership                               | —   | —       |                |
| QD4  | A enables selected public interests              | Only selected saved Pod interests appear                                                                    | —   | —       |                |
| QD5  | A disables indexing                              | Public interests, capabilities, and inbox metadata disappear while listing remains independent              | —   | —       |                |
| QD6  | A disables listing from second device            | A disappears promptly; stale first device cannot restore opt-in                                             | —   | —       |                |
| QR0  | B leaves inbound requests off, then enables them | A is rejected while off; requests become available only after explicit consent                              | —   | —       |                |
| QR1  | A requests B                                     | A outgoing pending; B incoming pending; no messaging                                                        | —   | —       |                |
| QR2  | B declines, then A retries and B accepts         | Decline and accepted transitions are correlated and durable                                                 | —   | —       |                |
| QR3  | A cancels pending request                        | B cannot later accept the cancelled request                                                                 | —   | —       |                |
| QR4  | Accepted A/B disconnect                          | Local messaging authority revokes immediately even when remote notification is unavailable                  | —   | —       |                |
| QC1  | Accepted A/B message from Directory              | Message succeeds only after acceptance                                                                      | —   | —       |                |
| QC2  | Message from Profile and Local                   | Shared relationship/safety state is consistent                                                              | —   | —       |                |
| QS1  | B mutes A                                        | B suppresses A locally without changing A's state                                                           | —   | —       |                |
| QS2  | B blocks A while chat is open                    | Messages/reveals disappear; channels close; A cannot reconnect                                              | —   | —       |                |
| QS3  | B unblocks A                                     | Recovery control works; no relationship or consent is fabricated                                            | —   | —       |                |
| QN1  | Grant location with presence off                 | No beacon, nearby subscription, or reveal begins                                                            | —   | —       |                |
| QN2  | Enable presence and reveal mutually              | Commitment appears first; raw WebID appears only after encrypted reveal                                     | —   | —       |                |
| QN3  | Revoke presence from second device               | Beacon/subscription/reveal state clears within the documented interval                                      | —   | —       |                |
| QB1  | Enable local broadcasts                          | Broadcast succeeds only with fresh Pod consent                                                              | —   | —       |                |
| QB2  | Disable broadcasts from second device            | Subsequent broadcast is rejected before publish                                                             | —   | —       |                |
| QA1  | Inspect network/storage/telemetry                | No bearer leakage, CSS contact, raw cohort WebIDs, private interests, blocks, H3 history, or message bodies | —   | —       |                |

Capture screenshots only when they do not contain private credentials, bearer tokens,
raw recovery bundles, private interests, block lists, or message content.

## Phase 8: Rollback Rehearsal

1. Use the authenticated N-1 baseline artifact captured before candidate deployment.
2. Dispatch `staging-rollback.yml` with `source_kind=baseline`, the baseline capture
   run ID/attempt, the captured baseline commit, and `source_tooling_commit` equal to
   the candidate SHA that executed the capture workflow. Never substitute the
   candidate's own deployment bundle for this N-1 rehearsal.
3. Require:
   - authenticated source-run provenance;
   - provisioner, relay, and PWA digest validation;
   - all Q flags forced dark before backend redeploy;
   - exact retained backend payloads live;
   - every retained PWA file hash live;
   - rollback marker identifies source run and rollback run.
4. Verify Pod-authoritative opt-outs, relationships, moderation, and private safety state
   survive rollback.
5. Forward-restore the candidate using `staging-deploy.yml` and repeat provenance and
   dark-state checks.

Because Basic B1 has no slots, brief backend interruption is possible. Record duration
and user-visible impact. Do not describe this as a slot swap.

## Phase 9: Soak and Release Decision

Observe for 24 hours or one complete relevant expiry interval, whichever is longer.
Track only privacy-safe aggregate evidence:

- auth/session failure counts;
- Directory refresh/index outcomes;
- relationship delivery/verification outcomes;
- transport verifier availability;
- App Service restarts and failed health probes;
- workflow and marker provenance.

Release GO requires:

- latest workflow success for the exact SHA;
- complete manual matrix on iOS and Android;
- successful rollback and forward restoration;
- no unresolved severity-1/2 defects;
- QA Release Agent GO;
- Audit Agent GO;
- Q flags remain dark except for the explicitly approved cohort.

## Evidence Record

| Field                           | Value |
| ------------------------------- | ----- |
| Candidate SHA                   | —     |
| Staging deploy run/attempt      | —     |
| Live marker SHA                 | —     |
| Retained rollback artifact      | —     |
| Rollback run                    | —     |
| Forward-restore run             | —     |
| iOS device/model/OS/browser     | —     |
| Android device/model/OS/browser | —     |
| User A sanitized account hash   | —     |
| User B sanitized account hash   | —     |
| Soak start/end UTC              | —     |
| QA decision                     | —     |
| Audit decision                  | —     |
| Final release decision          | —     |
