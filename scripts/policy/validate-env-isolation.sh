#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() {
  echo "[policy] FAIL: $1"
  exit 1
}

pass() {
  echo "[policy] PASS: $1"
}

# 1) Canonical staging domain must be nodezero.social (not nedzero.social).
if grep -RIn --exclude-dir=.git --exclude=pnpm-lock.yaml --exclude=validate-env-isolation.sh 'staging\.nedzero\.social' "$REPO_ROOT" >/dev/null 2>&1; then
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
grep -q "'staging-testnet'" "$BICEP_FILE" || fail "Bicep missing staging-testnet allowed environment value."
grep -q "'production-mainnet'" "$BICEP_FILE" || fail "Bicep missing production-mainnet allowed environment value."
pass "Bicep environment guardrails validated."

echo "[policy] All environment-isolation policy checks passed."
