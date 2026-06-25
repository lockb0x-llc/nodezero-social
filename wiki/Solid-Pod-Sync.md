# Solid Pod Sync

This package provides SOLID-backed profile and social graph synchronization.

## Core modules

- `packages/solid-pod-sync/src/ProfileManager.ts`
- `packages/solid-pod-sync/src/SocialGraph.ts`
- `packages/solid-pod-sync/src/NsfwScanner.ts`

## Testing

- `packages/solid-pod-sync/src/__tests__/NsfwScanner.test.ts`

## Integration

- Consumed by mobile app contexts and profile flows.
- Works with release policy checks described in `docs/environment-isolation-matrix.md`.
