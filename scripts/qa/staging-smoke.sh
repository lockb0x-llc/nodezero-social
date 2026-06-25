#!/usr/bin/env bash
#
# Staging smoke suite for the NodeZero.social staging-testnet release gate.
#
# Verifies that the published Static Web App is reachable over TLS, serves the
# landing/auth entry point, and resolves the core client routes (feed, local
# messaging, profile, settings). Interactive journeys that require a real Solid
# login (feed content, local messaging exchange, on-chain wallet registration)
# are covered by docs/staging-uat-checklist.md and must be signed off manually.
#
# Usage:
#   scripts/qa/staging-smoke.sh [BASE_URL]
#   STAGING_BASE_URL=https://staging.nodezero.social bash scripts/qa/staging-smoke.sh
set -euo pipefail

BASE_URL="${1:-${STAGING_BASE_URL:-https://staging.nodezero.social}}"
BASE_URL="${BASE_URL%/}"

fail() {
  echo "[smoke] FAIL: $1"
  exit 1
}

pass() {
  echo "[smoke] PASS: $1"
}

# Fetch helpers.
fetch_body() {
  curl -fsSL --max-time 30 "$1"
}

status_of() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$1"
}

# 0) Enforce TLS for any staging target.
case "$BASE_URL" in
  https://*) ;;
  *) fail "Staging base URL must use https (got '$BASE_URL')." ;;
esac
pass "Staging base URL uses https ($BASE_URL)."

# 1) Landing / Solid auth entry point reachable with stable markers.
LANDING="$(fetch_body "$BASE_URL/")" || fail "Landing page not reachable at $BASE_URL/."
echo "$LANDING" | grep -q "NodeZero" || fail "Landing page missing 'NodeZero' brand marker."
echo "$LANDING" | grep -q "Sign in with Solid Pod" || fail "Landing page missing Solid auth entry point."
pass "Landing page and Solid auth entry point served."

# 2) Core client routes resolve (SPA fallback returns the app shell).
for route in feed local profile settings; do
  code="$(status_of "$BASE_URL/$route")"
  case "$code" in
    200|301|302|304) pass "Route '/$route' reachable (HTTP $code)." ;;
    *) fail "Route '/$route' returned HTTP $code." ;;
  esac
done

echo "[smoke] All automated staging smoke checks passed against $BASE_URL."
echo "[smoke] Complete interactive journeys in docs/staging-uat-checklist.md before release sign-off."
