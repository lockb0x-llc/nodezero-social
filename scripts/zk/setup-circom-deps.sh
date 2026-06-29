#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$REPO_ROOT"

echo "[zk-setup] Verifying Circom toolchain"
command -v circom >/dev/null || {
  echo "[zk-setup] circom is required. Install the Rust compiler from https://github.com/iden3/circom" >&2
  exit 1
}
command -v snarkjs >/dev/null || {
  echo "[zk-setup] snarkjs is required. Install with: npm install -g snarkjs" >&2
  exit 1
}

echo "[zk-setup] Installing circomlib circuit includes"
pnpm --filter @nodezero/zk-crypto add circomlib@2.0.5 --ignore-scripts

POSEIDON_PATH="node_modules/circomlib/circuits/poseidon.circom"
PNPM_POSEIDON_PATH="$(find node_modules/.pnpm -path '*/node_modules/circomlib/circuits/poseidon.circom' -print -quit 2>/dev/null || true)"

if [[ -f "$POSEIDON_PATH" ]]; then
  echo "[zk-setup] FOUND $POSEIDON_PATH"
elif [[ -n "$PNPM_POSEIDON_PATH" && -f "$PNPM_POSEIDON_PATH" ]]; then
  echo "[zk-setup] FOUND $PNPM_POSEIDON_PATH"
else
  echo "[zk-setup] circomlib installed but poseidon.circom was not found" >&2
  exit 1
fi

echo "[zk-setup] Compiling circuits"
pnpm --filter @nodezero/zk-crypto build:circuits