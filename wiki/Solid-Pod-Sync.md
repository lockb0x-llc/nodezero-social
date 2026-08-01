# Solid Pod Sync

This package provides SOLID-backed profile and social graph synchronization.

## Core modules

- `packages/solid-pod-sync/src/ProfileManager.ts`
- `packages/solid-pod-sync/src/SocialGraph.ts`
- `packages/solid-pod-sync/src/NsfwScanner.ts`

## Staging Pod (verified 2026-06-25)

> **Identity provider policy:** The **Node Zero Community Server**
> (`https://solid.nodezero.social/`) is the default identity provider for all
> app sign-in and node creation. The `solidcommunity.net` account below is a
> legacy external-Pod test fixture, retained for the external-IdP sign-in path.

The `admin@nodezero.social` test account uses a Solid Pod at:

| Field | Value |
|---|---|
| Pod URL | `https://nodezero.solidcommunity.net/` |
| WebID | `https://nodezero.solidcommunity.net/profile/card#me` |
| OIDC Issuer | `https://solidcommunity.net/` |
| IdP for app sign-in | `https://solidcommunity.net/` |

**Pod structure** (as of 2026-06-25):
```
https://nodezero.solidcommunity.net/
  ├── README          (755 bytes — solidcommunity.net welcome)
  ├── robots.txt      (86 bytes)
  ├── inbox/          (LDP container)
  ├── public/         (LDP container)
  ├── profile/
  │   └── card        (WebID profile — foaf:Person, oidcIssuer, no name yet)
  └── settings/
      ├── prefs.ttl
      ├── privateTypeIndex.ttl
      └── publicTypeIndex.ttl
```

**Profile card state**: Fresh — the `foaf:Person` type is set with correct issuer but has no `foaf:name`, no bio, no NSFW flag, and no social connections. ProfileManager writes to this pod during onboarding.

**Social graph** (`/social/`): Not yet created — this path will be created by `SocialGraph.ts` when the first connection is added.

**Authentication**: The CSS client credentials (token ID + secret in `docs/dev-only/`) exchange for a 600s Bearer token at `https://solidcommunity.net/.oidc/token`. Pod root and profile require DPoP for write access. Profile card is publicly readable (GET without auth returns 200).

## Testing

- `packages/solid-pod-sync/src/__tests__/NsfwScanner.test.ts`

## Integration

- Consumed by mobile app contexts and profile flows.
- Works with release policy checks described in `docs/environment-isolation-matrix.md`.

## ACL Responsibility Boundary

Client-side responsibilities:
- Canonical ACL authoring for account-scoped resources.
- Handle-aware owner WebID derivation for path-based pods.
- Deterministic namespace target construction.

Server-side responsibilities:
- Authoritative namespace policy enforcement at ACL write boundary.
- Deny malformed or cross-namespace ACL writes.

Compatibility guarantees:
- Valid ACL writes remain accepted.
- Invalid ACL writes are rejected with structured `ruleId` responses.

## Consentful social data model

- A unilateral `foaf:knows` triple is owned by the writing Pod and does not prove
  reciprocal acceptance or permission to contact the referenced WebID.
- Milestone Q stores discovery manifests, relationship state, moderation state,
  inbox activities, receipts, and replay records as separate versioned resources.
- Accepted relationships project to `foaf:knows` for compatibility. Existing values
  migrate as `legacy-connected` without fabricated request or acceptance history.
- Public Type Index and LDN support are compatibility adapters. NodeZero does not
  claim full ActivityPub federation.
- Public discovery manifests contain only explicitly selected fields. Private
  interests, Trust Circles, blocks, H3/reveal history, and communication activity are
  not indexed.

Regression anchors:
- `packages/solid-pod-sync/src/PodLayoutManager.ts`
- `packages/solid-pod-sync/src/ProfileManager.ts`
- `packages/solid-pod-sync/src/__tests__/PodLayoutManager.test.ts`

## Docustream stabilization (2026-07-09)

- `DocustreamManager.listActivities` now supports Pod container listings returned
  as JSON-LD as well as Turtle, with normalization + dedupe of item URLs before
  fetch.
- Item fetch requests now send explicit `Accept` headers to improve
  cross-provider compatibility for JSON-LD/Turtle payloads.
- `DocustreamSourceManager` source-registry write failures now include richer
  diagnostics (`HTTP status`, `www-authenticate`, body snippet), improving
  auth/session triage in staging.

## Credits

- Solid protocol standards make Pod portability and user-owned data flows possible.
- Solid client libraries provide the core RDF and Pod data APIs used by this
  package. Browser authentication is internal to NodeZero; Pod requests are
  routed through the provisioner Pod Access Proxy.
- Community Solid Server powers the NodeZero-hosted Solid server environment in staging.
- NodeZero contributors implemented package-specific managers, contracts, and integration boundaries in-repo.
- Upstream references:
  - https://solidproject.org/
  - https://github.com/inrupt/solid-client-js
  - https://github.com/CommunitySolidServer/CommunitySolidServer

## Current baseline (`v0.2.0-testnet`)

| Gap | Description | Status |
|---|---|---|
| Feed aggregation | Pod-backed profile/social reads feed the chronological surface | RELEASE BASELINE |
| Profile data | Profile metadata writes and reload after returning sign-in | PASS |
| DocuStream | RSS source registry and listings reload after returning sign-in | PASS |
| Larger-data social graph | Scale and richer graph behaviors | NEXT FEATURES |

- `packages/solid-pod-sync/src/ProfileManager.ts`
- `packages/solid-pod-sync/src/SocialGraph.ts`
- `packages/solid-pod-sync/src/NsfwScanner.ts`

## Testing

- `packages/solid-pod-sync/src/__tests__/NsfwScanner.test.ts`

## Integration

- Consumed by mobile app contexts and profile flows.
- Works with release policy checks described in `docs/environment-isolation-matrix.md`.
