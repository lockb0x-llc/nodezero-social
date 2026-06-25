# Solid Pod Sync

This package provides SOLID-backed profile and social graph synchronization.

## Core modules

- `packages/solid-pod-sync/src/ProfileManager.ts`
- `packages/solid-pod-sync/src/SocialGraph.ts`
- `packages/solid-pod-sync/src/NsfwScanner.ts`

## Staging Pod (verified 2026-06-25)

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
