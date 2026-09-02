# ADR-001: Consentful Discovery and Communication

Status: Accepted  
Date: 2026-07-31  
Owners: Solid data, mobile application, P2P relay, and security owners

Decision drivers:

- Pod-owner control over public representation and relationships
- Meaningful and independently revocable consent
- Solid and Social Web interoperability without unnecessary federation scope
- Explainable discovery and privacy-preserving recommendations
- Abuse resistance before broad network growth
- Compatibility with the released Testnet identity and Pod architecture

## Context

NodeZero currently has working but separate social primitives:

- an operator-maintained, opt-in-capable Community Directory;
- unilateral `foaf:knows` connection writes in the initiating user's Pod;
- a chronological feed assembled from those connections;
- sender-curated Trust Circle membership;
- H3 and Waku nearby presence with mutual encrypted identity reveal;
- signed Waku chat, local broadcast, and legacy relay fallback; and
- notification orchestration for provisioning events.

These primitives do not yet provide one consentful lifecycle from discovery through
conversation. Directory membership, location permission, Trust Circle membership, and
unilateral connection state can also be mistaken for stronger permissions than they
actually represent.

## Decision

### Independent Consent Dimensions

NodeZero treats the following as independent and revocable choices:

1. Public directory listing.
2. Public profile indexing and selected public interests.
3. Nearby presence publication.
4. Per-peer nearby identity reveal.
5. Receipt of relationship requests.
6. Receipt of local broadcasts.
7. Optional notification channels.

All new consent scopes default off. Existing location permission, connections, Trust
Circles, directory records, or historical presence do not migrate into consent.

### Sources Of Truth

- The Pod owner's public discovery manifest is authoritative for public discovery.
- Each participant's private Pod relationship record is authoritative for that
  participant's relationship state.
- Private Pod moderation state is authoritative for mute, block, and report behavior.
- The operator directory is a rebuildable projection of valid public manifests and is
  never relationship authority.
- Waku presence and reveal state is ephemeral and does not create a durable
  relationship or public listing.

### Publication Transaction And Concurrency

Directory publication is a recoverable, idempotent transaction over separate Solid
resources rather than an atomic database write:

- Discovery consent carries a monotonic publication generation that advances when public
  listing/indexing changes and whenever a writer reserves a new public artifact revision.
  Writers reserve before reading artifact inputs. A manifest and its public Type Index
  registration carry the generation that authorized them; unrelated private consent
  changes are not exposed.
- RDF updates derived from an existing representation are fenced with its HTTP `ETag`
  through `If-Match`; first-write replacement uses `If-None-Match: *`.
- An existing RDF resource without an `ETag` is not mutated. An opt-in is not reported as
  published until consent, the current manifest, its public
  Type Index registration, and the authenticated derived projection agree.
- Opt-out suppresses the derived projection first, persists the Pod revocation, and then
  removes public artifacts. Cleanup may remove generation-stamped artifacts at or before
  the observed publication generation. During the staging-testnet clean cutover,
  generationless test artifacts are abandoned and may be removed only with their observed
  strong `ETag`; newer or concurrently replaced artifacts remain protected.
- Public listing and public indexing remain independent. Listing-only opt-out may retain
  the public manifest only when Pod consent still explicitly enables indexing; full
  opt-out removes the manifest and NodeZero Type Registration.
- The Pod proxy rejects protected consent, manifest, and Type Index mutations unless they
  carry both an HTTP precondition and a publication generation. The projection persists a
  separate suppression tombstone, permits same-generation completion of an incomplete
  projection, and allows only a newer generation to clear suppression.
- Every destructive phase re-reads Pod consent. A higher revision wins, and bounded
  reconciliation repairs the winning state before returning `pending-sync`.
- Directory responses expose only the minimal public card and recommendation fields;
  projection provenance remains operator-internal. Process-local queues are latency
  optimizations only. Correctness comes from Pod-owned
  revisions, HTTP preconditions, fail-closed projection rules, and idempotent replay.

### Relationship Lifecycle

The internal relationship state machine is:

`none -> outgoing-pending | incoming-pending -> accepted | rejected | cancelled`

An accepted relationship can later become disconnected. A local `blocked` state
overrides every state and transport. Transitions are idempotent and correlated with
immutable activity identifiers.

Existing `foaf:knows` values are imported as `legacy-connected` compatibility state.
NodeZero does not fabricate historical request or acceptance activities. Newly accepted
relationships are projected to `foaf:knows` while legacy clients remain supported.

### Protocol Boundary

NodeZero implements:

- WebID discovery;
- public Solid Type Index registration;
- Linked Data Notifications inbox discovery and delivery semantics;
- ActivityStreams-compatible `Follow`, `Accept`, `Reject`, `Undo`, and
  `Block` payloads; and
- `foaf:knows` compatibility projection.

This does not constitute full ActivityPub federation. Actor documents, WebFinger,
shared inboxes, followers/following federation, global content delivery, and general
Fediverse authentication remain out of scope.

### Transport Boundary

- Solid Pods store discovery manifests, relationships, moderation decisions, inbox
  activities, receipts, replay ledgers, and durable notification state.
- LDN provides durable relationship and social-event delivery.
- Waku provides ephemeral nearby presence, reveal, broadcast, and low-latency chat.
- The legacy WebRTC relay remains a fallback until separately retired.
- The provisioner may retry and cache delivery but does not become the social source of
  truth.

### Recommendation Boundary

Recommendations may use only:

- exact WebID lookup;
- explicit directory membership;
- explicitly selected public interests;
- accepted mutual connections;
- public verification state; and
- ephemeral mutually revealed nearby peers.

Every recommendation exposes a stable reason. Private interests, Trust Circles, block
lists, H3 history, revealed identity history, and communication activity are never
indexed or used as hidden ranking inputs.

### Safety Boundary

Block evaluation occurs before directory ranking, profile actions, relationship
delivery, compose recipient resolution, presence reveal, Waku subscriptions and
messages, and legacy relay signaling. Directory or Trust Circle membership alone never
makes an actor an eligible directed recipient.

## Rationale

This design uses the strongest existing NodeZero properties: user-controlled Pod data,
global WebIDs, explicit access control, device-bound identity, and an already deployed
ephemeral communication plane. It borrows interoperable message shapes and inbox
semantics without importing the operational and moderation scope of full social
federation.

Separating authoritative Pod records from rebuildable indexes follows the same useful
pattern as modern decentralized social systems that distinguish owned records from
aggregation services. Independent consent avoids converting ordinary actions such as
granting location permission into unrelated public or social exposure.

## Consequences

Positive:

- Discovery and communication permissions are explicit, inspectable, and revocable.
- The public directory can be rebuilt or replaced without losing social state.
- The implementation gains standards-compatible paths for cross-application use.
- Recommendation behavior can remain local, deterministic, and explainable.
- Safety rules apply consistently across durable and ephemeral transports.

Negative:

- Relationship state becomes more complex than a single `foaf:knows` triple.
- Public append-only inbox ACLs and remote fetches add security-sensitive server work.
- Existing users require a lazy migration and must explicitly opt into new public
  discovery.
- Cross-provider interoperability remains capability-dependent and initially limited.
- Derived indexes require expiry, deletion propagation, abuse controls, and drift
  reconciliation.

## Rejected Alternatives

1. **Treat directory listing as communication consent**
   - Rejected because visibility does not imply permission to contact or target.
2. **Treat `foaf:knows` as reciprocal acceptance**
   - Rejected because the initiating Pod owner can write it unilaterally.
3. **Use Trust Circle membership as an unconditional recipient list**
   - Rejected because it is sender-curated and not recipient consent.
4. **Adopt full ActivityPub federation now**
   - Rejected because it adds actor, authentication, delivery, moderation, and content
     federation obligations beyond the required product loop.
5. **Adopt AT Protocol repositories and AppViews**
   - Rejected because it would duplicate the existing Solid authority layer and does
     not solve NodeZero private-data requirements.
6. **Centralize authoritative relationships in the provisioner**
   - Rejected because it would weaken Pod portability and make the operator index the
     social source of truth.
7. **Automatically publish existing interests or directory records**
   - Rejected because historical storage does not establish informed public consent.

## Validation Plan

- RDF and JSON-LD contract round trips preserve unknown compatible data.
- Public append-only inbox ACLs prevent public reads, updates, deletes, and control.
- External discovery and delivery never forward NodeZero bearer credentials and reject
  SSRF, redirect, DNS-rebinding, oversized, and unsupported responses.
- Relationship transitions are idempotent and reject replay, actor mismatch, malformed
  payloads, and stale activities.
- Blocks override discovery, compose, LDN, Waku, and relay behavior.
- Existing `foaf:knows` migration is idempotent and does not fabricate acceptance.
- Directory opt-out and manifest expiry remove the public projection promptly.
- Two-account Testnet evidence covers request, accept, reject, cancel, disconnect,
  message, mute, block, and revocation.
- The latest staging workflow succeeds and deployed client/API provenance matches the
  candidate commit.

## Links

- [System description](../../system-description.md)
- [Architecture](../../architecture.md)
- [Milestone Q implementation plan](../../consentful-pod-owner-discovery-and-communication-plan.md)
- [Environment isolation matrix](../../environment-isolation-matrix.md)
- [Release verification](../../process/release-verification.md)
- [Solid Protocol](https://solidproject.org/TR/protocol)
- [Linked Data Notifications](https://www.w3.org/TR/ldn/)
- [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/)
