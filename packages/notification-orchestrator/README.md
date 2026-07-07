# @nodezero/notification-orchestrator

Notification orchestration primitives for NodeZero.

This package intentionally keeps orchestration logic independent from transport
bindings so lifecycle events, digest scheduling, and Pod-backed preference
resolution can evolve without coupling to auth flows.

## What it includes

- `NotificationOrchestrator` with:
  - `ingestLifecycleEvent(...)`
  - `runDigest(...)`
- Type-safe interfaces for:
  - lifecycle event envelopes
  - message storage
  - preference storage
  - user directory resolution
  - digest email sending

## Development

From workspace root:

```bash
corepack pnpm --filter @nodezero/notification-orchestrator type-check
corepack pnpm --filter @nodezero/notification-orchestrator test
```

## Runtime Wiring (Provisioner -> Orchestrator)

Run the orchestrator webhook service:

```bash
corepack pnpm --filter @nodezero/notification-orchestrator dev
```

Service endpoints:

- `GET /health`
- `POST /v1/events/provisioning`

Environment variables for orchestrator runtime:

- `NZ_NOTIFICATION_ORCHESTRATOR_PORT` (default `8282`)
- `ORCH_WEBHOOK_TOKEN` (optional bearer token required for ingest endpoint)
- `ORCH_USER_DIRECTORY_JSON` (optional JSON map from `webId` to `{ webId, email, podUrl }`)

Provisioner wiring:

- `JSS_NOTIFICATION_EVENT_MODE=webhook`
- `JSS_NOTIFICATION_WEBHOOK_URL=http://<orchestrator-host>:8282/v1/events/provisioning`
- `JSS_NOTIFICATION_WEBHOOK_TOKEN=<same-token-as-ORCH_WEBHOOK_TOKEN>`

With this wiring in place, provisioner lifecycle events flow directly into
`NotificationOrchestrator.ingestLifecycleEvent(...)` through the concrete
`ingestProvisionerEvent(...)` adapter.
