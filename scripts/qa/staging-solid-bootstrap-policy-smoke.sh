#!/usr/bin/env bash
#
# Focused staging-testnet smoke checks for Solid bootstrap + policy behavior.
#
# This script verifies three things:
# 1) app.config.js resolves staging profile and bootstrap flag coherently.
# 2) environment isolation policy guardrails pass.
# 3) targeted solid-pod-sync suites covering bootstrap, query, sync, and
#    adapter-boundary behavior remain green.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() {
  echo "[solid-bootstrap-smoke] FAIL: $1"
  exit 1
}

pass() {
  echo "[solid-bootstrap-smoke] PASS: $1"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is not available."
}

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return
  fi

  if command -v corepack >/dev/null 2>&1 && corepack pnpm --version >/dev/null 2>&1; then
    corepack pnpm "$@"
    return
  fi

  # Git Bash on Windows can expose a non-executable corepack shim; in that
  # case, delegate pnpm invocations to PowerShell where corepack works.
  if command -v pwsh.exe >/dev/null 2>&1; then
    pwsh.exe -NoProfile -Command "corepack pnpm $*"
    return
  fi

  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "corepack pnpm $*"
    return
  fi

  fail "Neither pnpm nor corepack is available in PATH."
}

require_cmd node

export NZ_ENV_PROFILE="${NZ_ENV_PROFILE:-staging-testnet}"
export NZ_RELAY_URL="${NZ_RELAY_URL:-wss://relay.staging.nodezero.social}"
export NZ_IDENTITY_CONTRACT_ID="${NZ_IDENTITY_CONTRACT_ID:-CSTAGINGIDENTITYEXAMPLE000000000000000000000000000000}"
export NZ_LOCKBOX_CONTRACT_ID="${NZ_LOCKBOX_CONTRACT_ID:-CSTAGINGLOCKBOXEXAMPLE0000000000000000000000000000000}"
export NZ_ZK_ARTIFACTS_URL="${NZ_ZK_ARTIFACTS_URL:-https://staging.nodezero.social/zk-artifacts}"
export NZ_ZK_MANIFEST_URL="${NZ_ZK_MANIFEST_URL:-https://staging.nodezero.social/zk-artifacts/manifest.json}"
export NZ_SOLID_OIDC_ISSUER_URL="${NZ_SOLID_OIDC_ISSUER_URL:-https://solid.nodezero.social/}"
export NZ_SOLID_SIGNUP_URL="${NZ_SOLID_SIGNUP_URL:-https://solid.nodezero.social/idp/register/}"
export NZ_NODEZERO_ISSUER_URL="${NZ_NODEZERO_ISSUER_URL:-https://solid.nodezero.social/}"
export NZ_SOLID_BOOTSTRAP_ENABLED="${NZ_SOLID_BOOTSTRAP_ENABLED:-true}"

if [[ "$NZ_ENV_PROFILE" != "staging-testnet" ]]; then
  fail "NZ_ENV_PROFILE must be staging-testnet for this smoke script (got '$NZ_ENV_PROFILE')."
fi

pushd "$ROOT_DIR" >/dev/null

CONFIG_JSON="$(node -e "const cfg=require('./packages/mobile-app/app.config.js'); console.log(JSON.stringify({envProfile:cfg.extra.envProfile,solidBootstrapEnabled:cfg.extra.solidBootstrapEnabled,nodeZeroIssuerUrl:cfg.extra.nodeZeroIssuerUrl,relayUrl:cfg.extra.relayUrl}))")"
echo "[solid-bootstrap-smoke] app.config resolved: $CONFIG_JSON"

echo "$CONFIG_JSON" | grep -q '"envProfile":"staging-testnet"' || fail "app.config envProfile did not resolve to staging-testnet."
echo "$CONFIG_JSON" | grep -q '"solidBootstrapEnabled":"true"' || fail "app.config solidBootstrapEnabled did not resolve to true."
echo "$CONFIG_JSON" | grep -q '"nodeZeroIssuerUrl":"https://solid.nodezero.social/"' || fail "app.config nodeZeroIssuerUrl does not match Node Zero Community Server."
pass "app.config staging bootstrap resolution checks."

run_pnpm policy:validate-env
pass "environment isolation guardrails."

run_pnpm --filter @nodezero/solid-pod-sync test -- \
  PodLayoutManager.test.ts \
  new-features.test.ts \
  createSolidPodSyncManagers.test.ts \
  QueryApi.test.ts \
  SyncEngine.test.ts \
  DocustreamAggregation.test.ts \
  MashlibWebAdapter.test.ts
pass "targeted solid-pod-sync bootstrap/query/sync/adapter tests."

run_pnpm --filter @nodezero/solid-pod-sync type-check
pass "solid-pod-sync type-check."

run_pnpm --filter @nodezero/mobile-app type-check
pass "mobile-app type-check."

popd >/dev/null

echo "[solid-bootstrap-smoke] All focused staging bootstrap/policy checks passed."