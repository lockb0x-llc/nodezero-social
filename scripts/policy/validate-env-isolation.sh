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
# Use tracked-file grep to avoid expensive scans across large local log artifacts.
if git -C "$REPO_ROOT" grep -nE 'staging\.nedzero\.social' -- . ':(exclude)pnpm-lock.yaml' ':(exclude)scripts/policy/validate-env-isolation.sh' >/dev/null 2>&1; then
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

# 6) Stellar auth shared secret must be referenced as a secret (not plain env var) in Bicep.
SOLID_BICEP="$REPO_ROOT/infrastructure/azure/solid-server.bicep"
file_contains_literal "$SOLID_BICEP" "NZ_STELLAR_AUTH_SHARED_SECRET" || fail "solid-server.bicep must wire NZ_STELLAR_AUTH_SHARED_SECRET."
file_contains_literal "$SOLID_BICEP" "stellarAuthSharedSecret" || fail "solid-server.bicep must declare stellarAuthSharedSecret as a @secure() parameter."
pass "Stellar auth secret Bicep wiring validated."

# 7) Internal-auth cutover: the legacy OIDC bridge and browser Solid OIDC
#    surfaces must never return. Sessions are provisioner-issued; the browser
#    must not hold Solid OIDC machinery or bridge endpoints.
PROVISIONER_SRC="$REPO_ROOT/packages/jss-provisioner/src/index.ts"
POD_PROXY_SRC="$REPO_ROOT/packages/jss-provisioner/src/podProxy.ts"
if grep -q '/v1/oidc-bridge/consume' "$PROVISIONER_SRC"; then
  fail "Legacy OIDC bridge endpoint reintroduced in the provisioner (cutover regression)."
fi
grep -q "'/v1/pod-proxy/'" "$POD_PROXY_SRC" || fail "Pod Access Proxy route prefix missing from podProxy.ts (session invariant unenforceable)."
grep -q 'handlePodProxyRequest' "$PROVISIONER_SRC" || fail "Provisioner router does not wire the Pod Access Proxy (session invariant unenforceable)."
MOBILE_PKG_JSON="$REPO_ROOT/packages/mobile-app/package.json"
if grep -q '@inrupt/solid-client-authn-browser' "$MOBILE_PKG_JSON"; then
  fail "Browser Solid OIDC dependency reintroduced in mobile-app (cutover regression)."
fi
grep -q 'NZ_JSS_PROVISIONER_URL is required' "$APP_CONFIG" || fail "Mobile app config must fail closed without NZ_JSS_PROVISIONER_URL on strict profiles."
pass "Internal-auth cutover guardrails validated."

# 8) Waku messaging backbone guardrails: staging deploy script must preserve
#    what-if preflight + environment coherence + secret nodekey handling, the
#    Bicep module must stay testnet-only, and the app config must validate
#    NZ_WAKU_BOOTSTRAP_PEERS environment isolation.
WAKU_DEPLOY_SCRIPT="$REPO_ROOT/scripts/azure/deploy-waku.sh"
WAKU_BICEP="$REPO_ROOT/infrastructure/azure/waku-node.bicep"
grep -q 'az deployment group what-if' "$WAKU_DEPLOY_SCRIPT" || fail "Waku deploy script missing mandatory what-if preflight."
grep -q 'Refusing production-mainnet deployment' "$WAKU_DEPLOY_SCRIPT" || fail "Waku deploy script missing production-mainnet refusal guard."
grep -q 'AZURE_WAKU_NODEKEY is required' "$WAKU_DEPLOY_SCRIPT" || fail "Waku deploy script missing nodekey requirement guard."
grep -q 'must not contain wakuNodeKey' "$WAKU_DEPLOY_SCRIPT" || fail "Waku deploy script missing parameters-file secret exclusion guard."
file_contains_literal "$WAKU_BICEP" "'staging-testnet'" || fail "waku-node.bicep missing staging-testnet allowed environment value."
if file_contains_literal "$WAKU_BICEP" "'production-mainnet'"; then
  fail "waku-node.bicep must not allow production-mainnet (testnet-only module)."
fi
file_contains_literal "$WAKU_BICEP" "wakuNodeKey" || fail "waku-node.bicep must declare wakuNodeKey as a @secure() parameter."
grep -q 'NZ_WAKU_BOOTSTRAP_PEERS' "$APP_CONFIG" || fail "Mobile app config missing NZ_WAKU_BOOTSTRAP_PEERS plumbing."
grep -q 'targets the production Waku host' "$APP_CONFIG" || fail "Mobile app config missing Waku cross-environment bootstrap guard."
pass "Waku messaging backbone guardrails validated."

# 9) Relay service infrastructure guardrails: staging deploy script must require
#    what-if preflight + explicit environment + parameters-file, refuse production
#    direct deploy, and Bicep module must constrain environmentName values.
RELAY_DEPLOY_SCRIPT="$REPO_ROOT/scripts/azure/deploy-relay-service.sh"
RELAY_BICEP="$REPO_ROOT/infrastructure/azure/relay-service.bicep"
grep -q 'AZURE_BICEP_PARAMETERS_FILE is required' "$RELAY_DEPLOY_SCRIPT" || fail "Relay deploy script missing explicit parameters-file requirement guard."
grep -q 'AZURE_ENVIRONMENT_NAME is required' "$RELAY_DEPLOY_SCRIPT" || fail "Relay deploy script missing environment requirement guard."
grep -q 'az deployment group what-if' "$RELAY_DEPLOY_SCRIPT" || fail "Relay deploy script missing mandatory what-if preflight."
grep -q 'Refusing production-mainnet deployment' "$RELAY_DEPLOY_SCRIPT" || fail "Relay deploy script missing production-mainnet refusal guard."
file_contains_literal "$RELAY_BICEP" "'staging-testnet'" || fail "relay-service.bicep missing staging-testnet allowed environment value."
file_contains_literal "$RELAY_BICEP" "'production-mainnet'" || fail "relay-service.bicep missing production-mainnet allowed environment value."
pass "Relay service infrastructure guardrails validated."

# 10) Contract manifest integrity: every recorded contract id must be a valid
#     56-character Stellar strkey, and testnet ids must never appear in mainnet
#     artifacts (or vice versa). This closes the gap that allowed hand-authored
#     placeholder mainnet ids to pass validation. See NC-06.
MAINNET_MANIFEST="$REPO_ROOT/deployments/stellar-mainnet.contracts.json"
TESTNET_MANIFEST="$REPO_ROOT/deployments/stellar-testnet.contracts.json"
MAINNET_PARAMS="$REPO_ROOT/infrastructure/azure/main.parameters.production-mainnet.json"

# Valid Soroban contract strkey: 'C' + 55 chars from the RFC4648 base32 alphabet
# (A-Z and 2-7). Digits 0, 1, 8 and 9 are not valid base32 symbols.
STRKEY_RE='^C[A-Z2-7]{55}$'

assert_contract_ids_valid() {
  local file="$1" label="$2"
  [ -f "$file" ] || return 0
  local ids
  ids="$(grep -oE '"(id|identityContractId|lockboxContractId)"[[:space:]]*:[[:space:]]*"[^"]*"' "$file" \
    | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/' | grep -v '^$' || true)"
  local id
  for id in $ids; do
    if ! printf '%s' "$id" | grep -qE "$STRKEY_RE"; then
      fail "$label contains an invalid Stellar contract id '$id' (expected 56-char strkey). Placeholder or hand-authored values are not permitted."
    fi
  done
}

assert_contract_ids_valid "$MAINNET_MANIFEST" "Mainnet contract manifest"
assert_contract_ids_valid "$MAINNET_PARAMS" "Production-mainnet Bicep parameters"

# Cross-lane leakage: no testnet contract id may appear in a mainnet artifact.
if [ -f "$TESTNET_MANIFEST" ]; then
  TESTNET_IDS="$(grep -oE '"id"[[:space:]]*:[[:space:]]*"C[A-Z2-7]{55}"' "$TESTNET_MANIFEST" \
    | sed -E 's/.*"(C[A-Z2-7]{55})"/\1/' | sort -u || true)"
  for tid in $TESTNET_IDS; do
    for mfile in "$MAINNET_MANIFEST" "$MAINNET_PARAMS"; do
      [ -f "$mfile" ] || continue
      if grep -q "$tid" "$mfile"; then
        fail "TestNet contract id $tid leaked into $(basename "$mfile") (environment isolation violation)."
      fi
    done
  done
fi
pass "Contract manifest integrity validated."

echo "[policy] All environment-isolation policy checks passed."
