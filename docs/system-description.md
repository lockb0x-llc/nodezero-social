# NodeZero Social System Description

Date: 2026-07-31  
Current release baseline: `v0.2.0-testnet`  
Canonical Testnet PWA: `https://staging.nodezero.social`

## Purpose

NodeZero Social is a decentralized social application designed around portable,
user-directed data and device-bound cryptographic identity. A Solid WebID identifies
the user, a Solid Pod stores profile and social data, a device-held Stellar keypair
authenticates the user, and a per-user Soroban lockb0x anchors the encrypted ownership
attestation.

The product goal is not infrastructure without operators. NodeZero currently operates
the Community Solid Server, provisioner, Pod Access Proxy, discovery index, and relay
services used by the Testnet application. The user controls the device Stellar key and
the authoritative data stored in their Pod, while the operator can observe or alter
Pod traffic and hosted data if its infrastructure is compromised. Product and security
claims must retain this distinction.

## Product Principles

1. **Pod authority**: profile, relationship, consent, moderation, and durable social
   state belong in the Pod of the agent that controls them.
2. **Explicit discovery**: public listing, public indexing, nearby presence, identity
   reveal, contact requests, and broadcast participation are separate choices.
3. **No implicit communication grant**: directory membership, recommendation results,
   location permission, Trust Circle membership, and unilateral `foaf:knows` state do
   not authorize contact or audience targeting.
4. **Explainable discovery**: recommendations identify their source, such as an exact
   WebID, public shared interest, accepted mutual connection, or mutually revealed
   nearby peer.
5. **Safety precedence**: a local block overrides discovery, relationship, compose,
   Solid delivery, Waku, and legacy WebRTC behavior.
6. **Environment isolation**: `local`, `staging-testnet`, and
   `production-mainnet` never share wallet state, contracts, credentials, indexes, or
   transport namespaces.

## Current Testnet Capabilities

| Capability | State | Notes |
|---|---|---|
| Internal Stellar authentication | Implemented and release-gated | One-tap device signatures, host-only browser session cookie, and no user-facing passwords or browser-to-CSS authentication. |
| Pod provisioning and access | Implemented and release-gated | The provisioner creates the Pod and proxies all browser Pod traffic. |
| V3 lockb0x ownership attestation | Implemented and release-gated | Browser-generated Groth16 proof, encrypted claim, per-user child contract, and fail-closed returning verification. |
| Profile and DocuStream persistence | Implemented and mobile-validated | Data survives sign-out, browser closure, and returning sign-in. |
| Community Directory | Implemented locally; deployment pending | Owner-controlled listing/indexing, selected public interests, paginated projections, explainable recommendations, and safety actions are implemented against the authenticated projection API. |
| Social graph and chronological feed | Relationship lifecycle implemented locally | Durable request, accept, reject, cancel, disconnect, private moderation, and accepted-only FOAF compatibility projection are implemented. |
| Trust Circle | Baseline implemented | Sender-curated Pod state used for explicit audience selection; it is not reciprocal trust. |
| Local presence and messaging | Consent/security implementation complete locally | Default-off Pod consent, rotating commitments, identity-bound signed Waku envelopes, encrypted reveal/DMs, accepted-and-unblocked enforcement, and proof-of-possession relay fallback are implemented; staging certification remains. |
| Broadcast | Partially implemented | Local Waku broadcast works; non-local compose does not yet provide complete recipient inbox delivery. |
| Social notifications | Scaffolded | The notification orchestrator currently handles provisioning lifecycle events and digests, not relationship or message events. |
| Production Mainnet | Not implemented | Separate contracts, resources, approvals, and release evidence are required. |

The accepted Testnet evidence is recorded in
[Milestone I Release Evidence](archive/2026-milestone-i/milestone-i-release-evidence-summary.md). Historical
evidence describes the release at its recorded date and is not rewritten when future
plans change.

## Target Social Lifecycle

The next product milestone is a complete consentful social loop:

1. A Pod owner explicitly publishes a minimal discovery manifest.
2. Another user discovers that manifest through exact WebID lookup, an opt-in derived
   directory, selected public interests, accepted mutual connections, or an ephemeral
   nearby reveal.
3. The application explains why the person is shown.
4. The requester sends a durable relationship request to the inbox advertised from the
   recipient's WebID.
5. The recipient accepts, rejects, ignores, or blocks the request.
6. Each participant stores its own authoritative relationship state in its Pod.
7. Accepted and unblocked relationships can initiate durable or low-latency
   communication according to the recipient's channel preferences.
8. Either participant can disconnect, mute, block, or revoke discovery without
   surrendering unrelated profile, wallet, or Pod functionality.

## Target Architecture Boundary

NodeZero will use standards-compatible building blocks without claiming full
ActivityPub federation:

- WebID and RDF links for agent and resource discovery.
- Solid public Type Index registration for discovery resources.
- Linked Data Notifications inbox discovery and delivery semantics.
- ActivityStreams-shaped `Follow`, `Accept`, `Reject`, `Undo`, and `Block`
  relationship payloads.
- `foaf:knows` as a compatibility projection of accepted relationships.
- Waku for ephemeral nearby presence, reveal, broadcast, and low-latency chat.

Full ActivityPub actor documents, WebFinger, shared inboxes, global content
federation, HTTP-signature federation, and AT Protocol repositories or AppViews are
outside this milestone.

## Trust Boundaries

| Component | Authority | Operator visibility |
|---|---|---|
| Device wallet | User device | Stellar secret and derived identity secret remain device-held. |
| User Pod data | Pod owner at the data-model level | The hosted CSS and provisioner proxy can observe stored data and requests. |
| Discovery manifest | Pod owner | Public fields are intentionally readable when the owner opts in. |
| Derived directory index | Rebuildable operator projection | The operator stores only validated, explicitly public manifest fields and provenance. |
| Relationship and moderation state | Each participant's Pod | Hosted infrastructure can observe the resources; other users receive only addressed activities or grants. |
| Waku and relay planes | Ephemeral transport | Peers and infrastructure can observe transport metadata according to protocol topology; message content is signed and encrypted where supported. |
| Stellar contracts | Public chain | Commitments, encrypted attestation data, contract state, and events are public. |

## Delivery And Release Boundaries

- Authentication remains internal-only and separate from application features.
- Browser Pod operations continue through `/v1/pod-proxy/*`; no browser OIDC,
  passwords, or direct browser-to-CSS requests are reintroduced.
- External public WebID discovery and inbox delivery use a credential-free,
  SSRF-resistant server path. NodeZero bearer credentials are never forwarded to an
  external origin.
- New discovery and communication behavior is deployed behind default-off feature
  flags and validated on `staging-testnet` before any promotion.
- Mainnet deployment is a separate future release and is not part of Milestone Q.

## Canonical References

- [Architecture](architecture.md)
- [Consentful Discovery and Communication ADR](adrs/consentful-discovery-communication/ADR-001-consentful-discovery-and-communication.md)
- [Milestone Q implementation plan](consentful-pod-owner-discovery-and-communication-plan.md)
- [Environment isolation matrix](environment-isolation-matrix.md)
- [Staging runtime roadmap](staging-runtime-implementation-roadmap.md)
- [Release verification](process/release-verification.md)
