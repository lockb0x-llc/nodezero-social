# @nodezero/relay-service

WebSocket signaling relay for NodeZero peer negotiation.

## Purpose

This service routes signaling messages between connected peers identified by `webId`.
It supports the same message model used by `@nodezero/p2p-comms`:

- offer
- answer
- ice-candidate

## Run locally

From repo root:

- `pnpm relay:dev`

Or directly:

- `pnpm --filter @nodezero/relay-service dev`

## Environment variables

- `RELAY_PORT` (default `8080`)
- `RELAY_MAX_MESSAGE_BYTES` (default `32768`)
- `RELAY_PING_INTERVAL_MS` (default `30000`)

## Connection contract

Clients connect to:

- `ws://<host>:<port>/?webId=<url-encoded-webid>`

Each message must be valid JSON with shape:

```json
{
  "type": "offer|answer|ice-candidate",
  "from": "<sender-webid>",
  "to": "<target-webid>",
  "payload": {}
}
```

## Safety behavior

- Rejects connections without `webId`.
- Rejects malformed or invalid message shapes.
- Rejects sender spoofing (`from` must match connection webId).
- Enforces max payload size.
- Replaces older session when the same `webId` reconnects.
