#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

normalize_posix_path() {
  local input_path="$1"
  if [[ -e "$input_path" ]]; then
    printf '%s' "$input_path"
    return
  fi
  if [[ "$input_path" =~ ^/mnt/([a-zA-Z])/(.*)$ ]]; then
    local alt_path
    alt_path="/${BASH_REMATCH[1],,}/${BASH_REMATCH[2]}"
    if [[ -e "$alt_path" ]]; then
      printf '%s' "$alt_path"
      return
    fi
  fi
  printf '%s' "$input_path"
}

REPO_ROOT="$(normalize_posix_path "$REPO_ROOT")"

fail() {
  echo "[policy] FAIL: $1"
  exit 1
}

pass() {
  echo "[policy] PASS: $1"
}

file_contains_literal() {
  local file_path="$1"
  local literal="$2"
  local repo_rel="${file_path#$REPO_ROOT/}"

  if [[ -f "$file_path" ]]; then
    grep -q "$literal" "$file_path"
    return
  fi

  if git -C "$REPO_ROOT" cat-file -e "HEAD:$repo_rel" 2>/dev/null; then
    git -C "$REPO_ROOT" show "HEAD:$repo_rel" | grep -q "$literal"
    return
  fi

  return 1
}

# 1) Canonical staging domain must be nodezero.social (not nedzero.social).
if grep -RIn \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=build \
  --exclude-dir=playwright-report \
  --exclude-dir=playwright-results \
  --exclude=pnpm-lock.yaml \
  --exclude=validate-env-isolation.sh \
  'staging\.nedzero\.social' "$REPO_ROOT" >/dev/null 2>&1; then
  fail "Found deprecated staging domain 'staging.nedzero.social'. Use staging.nodezero.social everywhere."
fi
pass "Canonical staging domain references validated."

# 2) Azure deploy script must require explicit environment and parameter file.
AZURE_DEPLOY_SCRIPT="$REPO_ROOT/scripts/azure/deploy.sh"
grep -q 'AZURE_BICEP_PARAMETERS_FILE is required' "$AZURE_DEPLOY_SCRIPT" || fail "Azure deploy script missing explicit parameters-file requirement guard."
grep -q 'AZURE_ENVIRONMENT_NAME is required' "$AZURE_DEPLOY_SCRIPT" || fail "Azure deploy script missing environment requirement guard."
grep -q 'az deployment group what-if' "$AZURE_DEPLOY_SCRIPT" || fail "Azure deploy script missing mandatory what-if preflight."
pass "Azure deployment script guardrails validated."

# 3) Stellar deploy script must enforce strict testnet invariants.
STELLAR_DEPLOY_SCRIPT="$REPO_ROOT/scripts/stellar/deploy-testnet.sh"
grep -q 'validate_testnet_invariants' "$STELLAR_DEPLOY_SCRIPT" || fail "Stellar deploy script missing strict testnet validation function."
grep -q 'ALLOW_NON_TESTNET' "$STELLAR_DEPLOY_SCRIPT" || fail "Stellar deploy script missing explicit non-testnet override variable."
pass "Stellar deployment script guardrails validated."

# 4) App config must use explicit environment profile.
APP_CONFIG="$REPO_ROOT/packages/mobile-app/app.config.js"
grep -q 'NZ_ENV_PROFILE' "$APP_CONFIG" || fail "Mobile app config missing NZ_ENV_PROFILE enforcement."
pass "Mobile runtime profile guardrails validated."

# 5) Bicep template must constrain environmentName values.
BICEP_FILE="$REPO_ROOT/infrastructure/azure/main.bicep"
file_contains_literal "$BICEP_FILE" "'staging-testnet'" || fail "Bicep missing staging-testnet allowed environment value."
file_contains_literal "$BICEP_FILE" "'production-mainnet'" || fail "Bicep missing production-mainnet allowed environment value."
pass "Bicep environment guardrails validated."

echo "[policy] All environment-isolation policy checks passed."
