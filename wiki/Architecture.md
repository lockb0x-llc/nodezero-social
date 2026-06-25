# Architecture

NodeZero Social uses a pnpm workspace monorepo with modular packages.

## Workspace structure

- `packages/mobile-app`: Expo routes and user flows.
- `packages/solid-pod-sync`: SOLID profile/content integration.
- `packages/p2p-comms`: local peer messaging channel and signaling.
- `packages/relay-service`: signaling relay backend.
- `packages/embedded-wallet`: Stellar wallet and enclave adapter.
- `packages/contracts`: Rust smart contracts.
- `packages/zk-crypto`: Circuits and proof tooling.
- `packages/geo-discovery`: H3-based nearby discovery.
- `infrastructure/azure`: Bicep deployment stack.

## Runtime flow

1. User actions originate in mobile app routes (`packages/mobile-app/app/`).
2. Identity and profile data sync through SOLID services (`packages/solid-pod-sync/src/`).
3. Local messaging uses `p2p-comms` with `relay-service` for rendezvous.
4. Wallet operations route through `embedded-wallet` and TestNet contracts.
5. Deployment and environment policy are enforced via scripts and Azure templates.

## Key references

- `packages/mobile-app/app/_layout.tsx`
- `packages/solid-pod-sync/src/index.ts`
- `packages/p2p-comms/src/P2PChannel.ts`
- `packages/relay-service/src/index.ts`
- `infrastructure/azure/main.bicep`
