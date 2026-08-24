#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  echo "Copy .env.example to .env and provide real staging values outside Git." >&2
  exit 1
fi

if grep -Eq 'REPLACE_(OUTSIDE_GIT|WITH_)' "$ENV_FILE"; then
  echo "Refusing deployment: placeholder values remain in $ENV_FILE." >&2
  exit 1
fi

cd "$ROOT_DIR/../.."
docker compose -f deployments/portable/compose.yml --env-file "$ENV_FILE" config >/dev/null
docker compose -f deployments/portable/compose.yml --env-file "$ENV_FILE" build
docker compose -f deployments/portable/compose.yml --env-file "$ENV_FILE" up -d
"$ROOT_DIR/healthcheck.sh" "$ENV_FILE"