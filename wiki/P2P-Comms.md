# P2P Comms

P2P communication is provided through a signaling + channel abstraction.

## Core modules

- `packages/p2p-comms/src/P2PChannel.ts`
- `packages/p2p-comms/src/SignalRelay.ts`
- `packages/p2p-comms/src/types.ts`

## Responsibilities

- Session setup and signaling transport.
- Message envelope typing for local messaging.
- Relay interoperability with staging endpoints.

## Related docs

- `docs/process/release-verification.md`
- `docs/staging-readiness-and-agent-plan.md`
