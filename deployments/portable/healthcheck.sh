#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env}"

set -a
. "$ENV_FILE"
set +a

cd "$ROOT_DIR/../.."
docker compose -f deployments/portable/compose.yml --env-file "$ENV_FILE" ps
curl --fail --silent --show-error "https://${PUBLIC_HOST}/" >/dev/null
curl --fail --silent --show-error "https://${API_HOST}/health" >/dev/null
curl --fail --silent --show-error "https://${SOLID_HOST}/" >/dev/null
curl --fail --silent --show-error "https://${RELAY_HOST}/healthz" >/dev/null
echo "Portable NodeZero health checks passed."