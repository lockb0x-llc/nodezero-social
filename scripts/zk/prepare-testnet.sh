#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$REPO_ROOT"
pnpm --filter @nodezero/zk-crypto build:all
node "$REPO_ROOT/scripts/zk/prepare-artifacts.mjs"
