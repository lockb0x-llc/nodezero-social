# Linked Data Notifications and ActivityStreams 2.0

**Status date:** 2026-09-01
**Conformance:** LDN — conformant within scope · AS2 — profile subset

## Relationship to ActivityPub

> **NodeZero does not implement ActivityPub.** It implements
> [Linked Data Notifications](https://www.w3.org/TR/ldn/) for delivery plus a scoped
> [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/) vocabulary for
> relationship payloads.
>
> Explicitly **not** implemented: actor documents, WebFinger, shared inboxes,
> server-to-server federation, HTTP Signatures federation, global content distribution.
>
> Tracked as [NC-05](known-non-conformance.md). This must never be described as
> federation.

## LDN roles

| Role | Implementation |
|---|---|
| Receiver | Each Pod exposes an `ldp:inbox` advertised from its WebID, with owner-controlled public append-only ACLs |
| Sender | `packages/jss-provisioner/src/relationshipDelivery.ts`, `packages/solid-pod-sync/src/OutboxDeliveryWorker.ts` |
| Consumer | `RelationshipInboxReader` — bounded direct-child reads, verification, replay-safe transitions |

### Discovery

The sender resolves the recipient's WebID document and reads `ldp:inbox`
(`WebIdDiscoveryClient`). Fetching uses a **credential-free, SSRF-resistant server path**;
NodeZero bearer credentials are never forwarded to an external origin.

> **Verification gap:** that SSRF resistance has **no test coverage** —
> [NC-09](known-non-conformance.md).

### Delivery

One outbox activity per action, then explicit delivery to each recipient inbox — not
per-recipient sender-outbox writes. Delivery carries a **recipient-bound, short-lived
delivery assertion**: a payload digest plus recipient, actor, activity ID, issuer, and
expiry, signed with a dedicated provisioner key. The recipient verifies it through an
authenticated endpoint.

**No session token or Pod credential is ever written into an inbox.**

Failures are recorded as retryable receipts with exponential backoff and idempotency
tracking. A failed pending request retries the **original immutable `Follow`** rather than
minting a second request.

## AS2 relationship profile

### Supported types

| Type | Meaning |
|---|---|
| `Follow` | A relationship request |
| `Accept` | Acceptance of a `Follow` |
| `Reject` | Rejection of a `Follow` |
| `Undo` | Correlated cancellation or disconnection |

No other AS2 activity types are accepted. Unknown or malformed payloads are quarantined
privately, never surfaced as social state.

### Receiver processing rules

1. **Sender verification** — the delivery assertion must verify and the actor must
   correlate to the activity.
2. **Replay suppression** — actor-bound, ETag-fenced replay leases; stale and
   future-dated activities are rejected.
3. **Duplicate suppression** — idempotent transitions.
4. **Block precedence** — a local block is applied **before** any inbox processing,
   rendering, or delivery. This overrides Solid, LDN, Waku, WebRTC, relay, and compose
   paths without exception.
5. **Bounded reads** — inbox reads are bounded and cancellation-safe against adversarial
   chunked responses.
6. **Consent** — inbound-request processing is Pod-authoritative and **defaults off**.

### Relationship states

`pending` · `accepted` · `rejected` · `cancelled` · `disconnected` · `muted` · `blocked`

All transitions are idempotent. Each participant stores its own authoritative state in its
own Pod. Accepted **and unblocked** state is required for any directed audience — directory
membership, recommendations, location permission, Trust Circle membership, and legacy
`foaf:knows` never authorize contact.

## Security vectors

`scripts/policy/validate-consentful-discovery.mjs` covers 22 versioned vectors across
inbox ACL, inbox flood, rate limiting, SSRF, credential isolation, replay, sender
verification, privacy, migration, and block precedence.

> **Caveat:** these are currently **static source-marker checks** (`readFile` only, zero
> `fetch`). They assert that the implementation contains the expected boundaries; they do
> **not** exercise deployed behavior. Replacing them with live assertions is
> [roadmap.md](../roadmap.md) item A4.

## References

- [Linked Data Notifications](https://www.w3.org/TR/ldn/) · [ActivityStreams 2.0 Core](https://www.w3.org/TR/activitystreams-core/) · [AS2 Vocabulary](https://www.w3.org/TR/activitystreams-vocabulary/)
- [ADR-001 Consentful Discovery and Communication](../adrs/consentful-discovery-communication/ADR-001-consentful-discovery-and-communication.md)
