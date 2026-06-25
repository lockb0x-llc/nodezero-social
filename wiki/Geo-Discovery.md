# Geo Discovery

Geo discovery uses H3 indexing to find nearby users while preserving privacy controls.

## Files

- `packages/geo-discovery/src/H3Grid.ts`
- `packages/geo-discovery/src/h3-grid.ts`
- `packages/geo-discovery/src/__tests__/h3-grid.test.ts`

## Behavior

- Converts user location to grid cells.
- Applies radius constraints for nearby results.
- Supports documentation-time mocked geolocation via `docs/dev-only/mock-geolocation.js`.
