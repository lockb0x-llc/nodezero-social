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
- `RELAY_IDENTITY_REVERIFY_INTERVAL_MS` (default `60000`)
- `RELAY_AUTH_CHALLENGE_TIMEOUT_MS` (default `10000`)
- `RELAY_MAX_PENDING_ADMISSIONS` (default `100`)
- `RELAY_PROVISIONER_URL` (required; verifies short-lived relay identity assertions)

## Connection contract

Clients connect with the WebSocket subprotocols `nz-relay-v1` and a short-lived
relay identity assertion issued by the authenticated provisioner. The relay
derives the WebID from successful assertion verification; WebID query parameters
are ignored.

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

- Rejects connections when `RELAY_PROVISIONER_URL` is missing or identity
  assertion verification fails.
- Rejects malformed or invalid message shapes.
- Rejects sender spoofing (`from` must match the provisioner-verified WebID).
- Enforces max payload size.
- Replaces older session when the same `webId` reconnects.
