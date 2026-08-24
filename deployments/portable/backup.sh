#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${1:-$ROOT_DIR/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/nodezero-$STAMP"

mkdir -p "$TARGET"
docker run --rm -v nodezero_solid-data:/source:ro -v "$TARGET:/backup" alpine:3.20 \
  tar -czf /backup/solid-data.tgz -C /source .
docker run --rm -v nodezero_provisioner-state:/source:ro -v "$TARGET:/backup" alpine:3.20 \
  tar -czf /backup/provisioner-state.tgz -C /source .
cp "$ROOT_DIR/.env.example" "$TARGET/env.example"
git -C "$ROOT_DIR/../.." rev-parse HEAD > "$TARGET/release-commit.txt"
echo "Created backup: $TARGET"
echo "Encrypt and copy this directory off-host before removing local copies."