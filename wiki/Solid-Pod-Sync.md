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

Regression anchors:
- `packages/solid-pod-sync/src/PodLayoutManager.ts`
- `packages/solid-pod-sync/src/ProfileManager.ts`
- `packages/solid-pod-sync/src/__tests__/PodLayoutManager.test.ts`

## Credits

- Solid protocol standards make Pod portability and user-owned data flows possible.
- Inrupt Solid client/auth libraries provide the core Solid OIDC + Pod data APIs used by this package.
- Community Solid Server powers the NodeZero-hosted Solid server environment in staging.
- NodeZero contributors implemented package-specific managers, contracts, and integration boundaries in-repo.
- Upstream references:
  - https://solidproject.org/
  - https://github.com/inrupt/solid-client-js
  - https://github.com/CommunitySolidServer/CommunitySolidServer

## Gaps (as of 2026-06-25)

| Gap | Description | Status |
|---|---|---|
| B1 | Real Solid-based feed aggregation not implemented | IN_PROGRESS |
| Profile data | No custom profile data written to pod yet | Pending browser sign-in |
| Social graph | `/social/connections` not yet created in pod | Pending B1/B2 |

- `packages/solid-pod-sync/src/ProfileManager.ts`
- `packages/solid-pod-sync/src/SocialGraph.ts`
- `packages/solid-pod-sync/src/NsfwScanner.ts`

## Testing

- `packages/solid-pod-sync/src/__tests__/NsfwScanner.test.ts`

## Integration

- Consumed by mobile app contexts and profile flows.
- Works with release policy checks described in `docs/environment-isolation-matrix.md`.
