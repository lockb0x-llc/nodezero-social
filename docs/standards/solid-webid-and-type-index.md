# Solid Protocol, WebID, and Type Indexes

**Status date:** 2026-09-01 · **Conformance:** Partially conformant (documented deviation)

## Scope

NodeZero uses [Solid](https://solidproject.org/TR/protocol) as its authoritative user data
plane. Each user has a Pod on the NodeZero Community Server (Community Solid Server on
Azure Container Apps) and a WebID that identifies them across the system.

The Pod is authoritative for profile, relationship, consent, moderation, and durable
social state. Operator-side projections such as the Community Directory are rebuildable
derivatives and never authoritative.

## Implementation

| Capability | Module |
|---|---|
| Pod read/write | `packages/solid-pod-sync/src/ProfileManager.ts`, `SocialGraph.ts` |
| Pod Access Proxy | `packages/jss-provisioner` — `/v1/pod-proxy/*` |
| Public Type Index | `PublicTypeIndexManager` |
| WebID discovery | `WebIdDiscoveryClient` |
| Portability | `PodArchiveExporter.ts`, `PodArchiveRestorer.ts` |

## Deviation: no browser Solid-OIDC

**This is the one significant divergence from typical Solid client architecture, and it is
deliberate.**

Standard Solid clients authenticate the browser directly against the Pod's OIDC issuer.
NodeZero does not:

- The user's only credential is a device-held **Stellar Ed25519 keypair**. There are no
  user-facing passwords and no external identity provider.
- The browser **never contacts the Solid server origin**. All Pod traffic is proxied
  through `/v1/pod-proxy/*` using a NodeZero session bearer token.
- Per-user Solid client credentials are held encrypted (AES-256-GCM) in the provisioner's
  credential store and never reach the client.
- The provisioner mints DPoP-bound Solid tokens server-side.

**Consequences, stated honestly:**

- NodeZero is **not** a general-purpose Solid client. It cannot authenticate against an
  arbitrary third-party Pod provider.
- The operator is in the data path for every Pod operation and can observe or alter
  traffic if compromised. Users control the device key and the authoritative data model;
  they do not have cryptographic protection against a compromised operator.
- The benefit is a passwordless, redirect-free session model with a fail-closed invariant:
  *signed in ⟺ the provisioner can mint a live Solid token right now.*

This deviation is enforced by policy — `scripts/policy/validate-env-isolation.sh` fails the
build if `@inrupt/solid-client-authn-browser` appears in the app manifest or if the OIDC
bridge route reappears.

## Type Indexes

NodeZero registers discovery resources in the user's **public Type Index** per the
[Solid Type Index](https://solid.github.io/type-indexes/) draft, so that other agents can
locate a user's published resources from their WebID.

**Privacy rule (binding):** private interests, Trust Circles, block lists, location
history, reveal history, and communication activity **MUST NEVER** be registered in a
public Type Index or any operator projection.

## WebID profile

The WebID document carries:

- Basic public profile fields the user has chosen to publish.
- `ldp:inbox` — the LDN inbox, see [ldn-and-activitystreams.md](ldn-and-activitystreams.md).
- `solid:publicTypeIndex`.
- `foaf:knows` — accepted relationships only, as a **one-way compatibility projection**.
  See below.

## FOAF projection

`foaf:knows` is a projection of accepted relationships, never a source of truth and never
a grant of consent:

- Only **accepted** relationships project.
- Disconnecting removes only NodeZero-owned values; unrelated RDF is preserved.
- Pre-existing `foaf:knows` values are lazily migrated to `legacy-connected` records.
  Historical request/accept events are **never fabricated**, and public consent is never
  inferred from legacy data.

Modules: `RelationshipFoafProjector.ts`, `LegacyRelationshipMigrator.ts`.

## Pod portability

`PodArchiveExporter` / `PodArchiveRestorer` provide user-initiated export and restore of
Pod data. **Verification gap:** 11 unit tests exist, but there is no round-trip fidelity
gate and no UAT acceptance row. Tracked in [roadmap.md](../roadmap.md) item C4.

## References

- [Solid Protocol](https://solidproject.org/TR/protocol) · [WebID](https://www.w3.org/2005/Incubator/webid/spec/identity/)
- [Solid Type Indexes](https://solid.github.io/type-indexes/) · [FOAF](http://xmlns.com/foaf/spec/)
- [Community Solid Server](https://github.com/CommunitySolidServer/CommunitySolidServer)
