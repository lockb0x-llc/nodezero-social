# Mobile App

The mobile app package hosts the main user experience via Expo Router.

## Primary routes

- `packages/mobile-app/app/index.tsx`
- `packages/mobile-app/app/feed.tsx`
- `packages/mobile-app/app/local.tsx`
- `packages/mobile-app/app/profile.tsx`
- `packages/mobile-app/app/settings.tsx`

## Contexts

- `WalletContext`: wallet lifecycle and registration.
- `SolidContext`: SOLID identity/session handling.
- `DiscoveryContext`: location/discovery state.

## Notes

- Staging profile and chain settings are guarded for environment coherence.
- SWA deployment support is wired for the web build path.
