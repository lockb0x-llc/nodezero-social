#!/usr/bin/env bash
#
# Focused proof for Layer 5 web runtime pane resolution.
#
# Verifies:
# 1) app.config resolves mashlib explorer flags in staging profile.
# 2) adapter test confirms bound pane labels are populated for docustream.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() {
  echo "[mashlib-runtime-proof] FAIL: $1"
  exit 1
}

pass() {
  echo "[mashlib-runtime-proof] PASS: $1"
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
export NZ_MASHLIB_EXPLORER_ENABLED="${NZ_MASHLIB_EXPLORER_ENABLED:-true}"
export NZ_MASHLIB_MODULE_ID="${NZ_MASHLIB_MODULE_ID:-nodezero:mashlib-pane-provider}"

pushd "$ROOT_DIR" >/dev/null

CONFIG_JSON="$(node -e "const cfg=require('./packages/mobile-app/app.config.js'); console.log(JSON.stringify({envProfile:cfg.extra.envProfile,mashlibExplorerEnabled:cfg.extra.mashlibExplorerEnabled,mashlibModuleId:cfg.extra.mashlibModuleId}))")"
echo "[mashlib-runtime-proof] app.config resolved: $CONFIG_JSON"

echo "$CONFIG_JSON" | grep -q '"envProfile":"staging-testnet"' || fail "app.config envProfile did not resolve to staging-testnet."
echo "$CONFIG_JSON" | grep -q '"mashlibExplorerEnabled":"true"' || fail "app.config mashlibExplorerEnabled did not resolve to true."
echo "$CONFIG_JSON" | grep -q '"mashlibModuleId":"nodezero:mashlib-pane-provider"' || fail "app.config mashlibModuleId did not resolve to expected module id."
pass "staging mashlib runtime flags resolved."

run_pnpm --filter @nodezero/solid-pod-sync test -- MashlibWebAdapter.test.ts
pass "adapter bound-pane runtime proof tests."

popd >/dev/null

echo "[mashlib-runtime-proof] Focused mashlib runtime proof checks passed."
