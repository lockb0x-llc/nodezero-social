# Relay Service

Relay service provides HTTP signaling endpoints for local messaging rendezvous.

## Files

- `packages/relay-service/src/index.ts`
- `packages/relay-service/Dockerfile`

## Health endpoints

- `/health`
- `/healthz`

## Deployment

- Containerized for staging deployment workflows.
- Validated in smoke checks referenced by `scripts/qa/staging-smoke.sh`.
