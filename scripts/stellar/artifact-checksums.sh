#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOYMENTS_DIR="$REPO_ROOT/deployments"
CHECKSUM_FILE="$DEPLOYMENTS_DIR/testnet-artifact-checksums.sha256"
MODE="${1:-generate}"

FILES=(
  "stellar-testnet.contracts.json"
  "staging-domain-cutover.json"
)

if [[ -f "$DEPLOYMENTS_DIR/zk-testnet-artifacts.json" ]]; then
  FILES+=("zk-testnet-artifacts.json")
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

write_checksums() {
  : > "$CHECKSUM_FILE"
  for file in "${FILES[@]}"; do
    local path="$DEPLOYMENTS_DIR/$file"
    if [[ ! -f "$path" ]]; then
      echo "Missing artifact: $path"
      exit 1
    fi
    local digest
    digest="$(sha256sum "$path" | awk '{print $1}')"
    echo "$digest  $file" >> "$CHECKSUM_FILE"
  done

  echo "Wrote checksums: $CHECKSUM_FILE"
}

verify_checksums() {
  if [[ ! -f "$CHECKSUM_FILE" ]]; then
    echo "Checksum file not found: $CHECKSUM_FILE"
    exit 1
  fi

  pushd "$DEPLOYMENTS_DIR" >/dev/null
  sha256sum --check "$(basename "$CHECKSUM_FILE")"
  popd >/dev/null
}

require_cmd sha256sum

case "$MODE" in
  generate)
    write_checksums
    ;;
  verify)
    verify_checksums
    ;;
  *)
    echo "Unknown mode '$MODE'. Use: generate | verify"
    exit 1
    ;;
esac
