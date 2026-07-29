#!/usr/bin/env bash
#
# Deployed-artifact proof for Layer 5 mashlib runtime wiring.
#
# Verifies the published staging bundle includes:
# 1) explicit module-id sentinel path
# 2) first-party pane provider payload markers
# 3) multi-identity returning-auth broker operation
# 4) enabled DocuStream Pod/profile persistence markers with no lock strings

set -euo pipefail

BUNDLE_FILE="${STAGING_BUNDLE_FILE:-}"
BASE_URL="${STAGING_BASE_URL:-https://staging.nodezero.social}"

fail() {
  echo "[mashlib-deployed-proof] FAIL: $1"
  exit 1
}

pass() {
  echo "[mashlib-deployed-proof] PASS: $1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle-file)
      [[ $# -ge 2 ]] || fail "--bundle-file requires a path argument."
      BUNDLE_FILE="$2"
      shift 2
      ;;
    --base-url)
      [[ $# -ge 2 ]] || fail "--base-url requires a URL argument."
      BASE_URL="$2"
      shift 2
      ;;
    *)
      # Backward compatibility: first positional arg treated as base URL.
      BASE_URL="$1"
      shift
      ;;
  esac
done

BASE_URL="${BASE_URL%/}"

fetch_body() {
  curl -fsSL --max-time 30 "$1"
}

if [[ -n "$BUNDLE_FILE" ]]; then
  [[ -f "$BUNDLE_FILE" ]] || fail "Bundle file '$BUNDLE_FILE' does not exist."
  BUNDLE="$(cat "$BUNDLE_FILE")" || fail "Unable to read bundle file '$BUNDLE_FILE'."
else
  case "$BASE_URL" in
    https://*) ;;
    *) fail "Base URL must use https (got '$BASE_URL')." ;;
  esac

  LANDING="$(fetch_body "$BASE_URL/")" || fail "Landing page not reachable."
  BUNDLE_PATH="$(printf '%s' "$LANDING" | sed -nE 's/.*src="([^"]*\/_expo\/static\/js\/web\/[^"]+\.js)".*/\1/p' | head -n1 || true)"

  if [[ -z "$BUNDLE_PATH" ]]; then
    fail "Unable to resolve staging web bundle path from landing HTML."
  fi

  BUNDLE="$(fetch_body "$BASE_URL$BUNDLE_PATH")" || fail "Unable to fetch bundle at '$BUNDLE_PATH'."
fi

# Module-id sentinel should be bundled when externalized path is active.
grep -q 'nodezero:mashlib-pane-provider' <<<"$BUNDLE" || fail "Bundle missing module-id sentinel 'nodezero:mashlib-pane-provider'."

# First-party pane provider payload markers.
grep -q 'Activity Stream' <<<"$BUNDLE" || fail "Bundle missing pane label marker 'Activity Stream'."
grep -q 'Timeline View' <<<"$BUNDLE" || fail "Bundle missing pane label marker 'Timeline View'."

# Returning authentication must enumerate every wallet identity, not only the active key.
grep -q 'list-identities' <<<"$BUNDLE" || fail "Bundle missing multi-identity wallet enumeration marker."
grep -q 'import-legacy-identity' <<<"$BUNDLE" || fail "Bundle missing legacy wallet import marker."
grep -q 'nz-legacy-wallet-migration-v1' <<<"$BUNDLE" || fail "Bundle missing cross-origin legacy migration protocol marker."

# DocuStream source registry and WebID profile links must be deployed and remain unlocked.
grep -q 'docustreamSourceRegistry' <<<"$BUNDLE" || fail "Bundle missing DocuStream profile registry link marker."
grep -q 'docustreamContainer' <<<"$BUNDLE" || fail "Bundle missing DocuStream profile container link marker."
grep -q 'source registry is missing an ETag' <<<"$BUNDLE" || fail "Bundle missing DocuStream ETag fencing marker."
if grep -q 'DocuStream is currently read-only while we complete a storage refactor.' <<<"$BUNDLE"; then
  fail "Bundle still contains the obsolete DocuStream read-only message."
fi
if grep -q 'temporarily disabled during the storage refactor lock' <<<"$BUNDLE"; then
  fail "Bundle still contains a DocuStream storage-refactor lock."
fi

pass "bundle contains pane, multi-identity auth, and enabled DocuStream persistence markers."

if [[ -n "$BUNDLE_FILE" ]]; then
  echo "[mashlib-deployed-proof] Local bundle proof checks passed for $BUNDLE_FILE."
else
  echo "[mashlib-deployed-proof] Deployed mashlib runtime proof checks passed against $BASE_URL."
fi
