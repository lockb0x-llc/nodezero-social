# Conformance Matrix

**Status date:** 2026-09-01 · **Branch:** `testnet` @ `3cb6450` · **Deployed:** run `33284499441`

Conformance levels:

| Level | Meaning |
|---|---|
| **Conformant** | Implements the specification for its declared scope; deployed; tested |
| **Partially conformant** | Deployed, with specific documented deviations |
| **Profile subset** | Implements a deliberately scoped subset; the wider spec is not claimed |
| **Primitive only** | Code exists and is tested but has **no production consumer** |
| **Not implemented** | Absent. Must not be claimed |

---

## Matrix

| Standard | Version | Level | Implementation | Tests | Non-conformance |
|---|---|---|---|---|---|
| [Solid Protocol](https://solidproject.org/TR/protocol) / WebID | 0.9 | **Partially conformant** | Pod Access Proxy `/v1/pod-proxy/*`; WebID derivation; `packages/solid-pod-sync/src/SocialGraph.ts` | `solid-pod-sync` (37 files) | Deviation: no browser Solid-OIDC; server-mediated DPoP. See [solid-webid-and-type-index.md](solid-webid-and-type-index.md) |
| [Solid Type Indexes](https://solid.github.io/type-indexes/) | Draft | **Conformant** (public index) | `PublicTypeIndexManager` | `__tests__/PublicTypeIndexManager.test.ts` | Private index scope limited |
| [Linked Data Notifications](https://www.w3.org/TR/ldn/) | REC 2017 | **Conformant** (scoped) | `packages/jss-provisioner/src/relationshipDelivery.ts`; `OutboxDeliveryWorker.ts`; `WebIdDiscoveryClient` | `OutboxDeliveryWorker.test.ts` (7), `WebIdDiscoveryClient.test.ts` | Scoped to relationship activities. Egress SSRF-resistance is **untested** — [NC-09](known-non-conformance.md) |
| [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/) | REC 2017 | **Profile subset** | `adapters/ActivityStreamsRelationshipAdapter.ts` | `solid-pod-sync` suite | Relationship vocabulary only (`Follow`/`Accept`/`Reject`/`Undo`). **Not ActivityPub** — [NC-05](known-non-conformance.md) |
| [FOAF](http://xmlns.com/foaf/spec/) | 0.99 | **Conformant** (projection) | `RelationshipFoafProjector.ts`, `LegacyRelationshipMigrator.ts` | `solid-pod-sync` suite | One-way projection of accepted relationships. `foaf:knows` is compatibility state, never consent |
| [W3C DID Core](https://www.w3.org/TR/did-core/) (`did:pkn`) | 1.0 REC | **Partially conformant (document) / non-conformant (resolution)** | `DidPknResolver.ts`, `contracts/DidContract.ts`, `GET /v1/did/:did` | `DidPknResolver.test.ts` (10), `index.did.test.ts` | **[NC-01 critical](known-non-conformance.md)** — no chain binding, constant key. Plus NC-02, NC-06. See [did-pkn-method.md](did-pkn-method.md) |
| [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) PRF extension | WD | **Primitive only** | `packages/embedded-wallet/src/WebAuthnPrfStore.ts` | `WebAuthnPrfStore.test.ts` (5) | **No passkey ceremony, zero consumers** — [NC-03](known-non-conformance.md) |
| Groth16 / BN254 ZK attestation | — | **Deployed** | Circuit `pod_stellar_bridge_v3`; `packages/zk-crypto`, `packages/contracts` | `qa:audit:lockbox` (blocking) | Verification is **off-chain and provisioner-trusted** — [NC-04](known-non-conformance.md) |
| [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/) | — | **Not implemented** | — | — | Must not be claimed — [NC-07](known-non-conformance.md) |
| [Multibase](https://datatracker.ietf.org/doc/draft-multiformats-multibase/) / Multicodec (Ed25519) | Draft | **Conformant** | `encodeEd25519PublicKeyMultibase` — `0xed 0x01` prefix, base58btc, `z` | `DidPknResolver.test.ts` | — |
| [CID](https://github.com/multiformats/cid) (Codex adapter) | v0/v1 | **Not conformant** | `adapters/CodexStorageAdapter.ts` | `CodexStorageAdapter.test.ts` (6) | Fabricated identifiers, not CIDs — [NC-08](known-non-conformance.md) |

---

## Reading guidance

- **Deployed and trustworthy today:** Solid/WebID, Type Indexes, LDN, AS2 subset, FOAF
  projection, and the ZK attestation (within its documented off-chain trust boundary).
- **Do not rely on:** `did:pkn` resolution for authentication (NC-01), WebAuthn PRF as a
  security control (NC-03), or the Codex adapter for content addressing (NC-08).
- **Do not claim at all:** Verifiable Credentials, ActivityPub federation.
