#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/packages/contracts"
DEPLOYMENTS_DIR="$REPO_ROOT/deployments"
NETWORK_NAME="${STELLAR_NETWORK_NAME:-mainnet}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Public Global Stellar Network ; September 2015}"
NETWORK_RPC_URL="${STELLAR_RPC_URL:-https://soroban-rpc.mainnet.stellar.org}"
SOURCE_ACCOUNT="${STELLAR_SOURCE_ACCOUNT:-nodezero-mainnet-deployer}"
IDENTITY_ALIAS="${STELLAR_IDENTITY_ALIAS:-nodezero-identity-mainnet}"
LOCKBOX_ALIAS="${STELLAR_LOCKBOX_ALIAS:-nodezero-lockbox-mainnet}"
LOCKBOX_FACTORY_ALIAS="${STELLAR_LOCKBOX_FACTORY_ALIAS:-nodezero-lockbox-factory-mainnet}"
ALLOW_NON_MAINNET="${ALLOW_NON_MAINNET:-0}"

EXPECTED_MAINNET_NAME="mainnet"
EXPECTED_MAINNET_PASSPHRASE="Public Global Stellar Network ; September 2015"
EXPECTED_MAINNET_RPC_URL="https://soroban-rpc.mainnet.stellar.org"
declare -A CONTRACT_MODES
declare -A CONTRACT_INIT_PROOFS

fail() {
  echo "[mainnet-deploy] FAIL: $1"
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

require_stellar_cli_major_27() {
  local version raw major
  raw="$(stellar --version 2>/dev/null || true)"
  version="$(echo "$raw" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
  major="${version%%.*}"

  if [[ -z "$version" || -z "$major" ]]; then
    fail "Could not parse 'stellar --version' output: '$raw'"
  fi

  if [[ "$major" != "27" ]]; then
    fail "Stellar CLI major version 27 is required for this release flow. Detected: $version"
  fi
}

validate_mainnet_invariants() {
  if [[ "$ALLOW_NON_MAINNET" == "1" ]]; then
    echo "[mainnet-deploy] WARNING: ALLOW_NON_MAINNET=1 set; bypassing strict mainnet invariants."
    return
  fi

  if [[ "$NETWORK_NAME" != "$EXPECTED_MAINNET_NAME" ]]; then
    fail "Refusing deploy: STELLAR_NETWORK_NAME must be '$EXPECTED_MAINNET_NAME' (got '$NETWORK_NAME')."
  fi

  if [[ "$NETWORK_PASSPHRASE" != "$EXPECTED_MAINNET_PASSPHRASE" ]]; then
    fail "Refusing deploy: STELLAR_NETWORK_PASSPHRASE does not match the Stellar MainNet passphrase."
  fi

  if [[ "$NETWORK_RPC_URL" != "$EXPECTED_MAINNET_RPC_URL" && "$NETWORK_RPC_URL" != "https://horizon.stellar.org" ]]; then
    fail "Refusing deploy: STELLAR_RPC_URL must be a verified Stellar MainNet RPC endpoint (got '$NETWORK_RPC_URL')."
  fi

  if [[ "$SOURCE_ACCOUNT" =~ testnet ]]; then
    fail "Refusing deploy: SOURCE_ACCOUNT '$SOURCE_ACCOUNT' appears to be a testnet account alias."
  fi
}

resolve_or_deploy_contract() {
  local alias="$1"
  local existing_id

  existing_id="$(stellar contract id --network "$NETWORK_NAME" --alias "$alias" 2>/dev/null || true)"
  if [[ -n "$existing_id" ]]; then
    CONTRACT_MODES["$alias"]="reused"
    echo "$existing_id"
    return
  fi

  CONTRACT_MODES["$alias"]="created"

  stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source-account "$SOURCE_ACCOUNT" \
    --network "$NETWORK_NAME" \
    --alias "$alias"
}

require_cmd cargo
require_cmd rustup
require_cmd stellar

require_stellar_cli_major_27
validate_mainnet_invariants

mkdir -p "$DEPLOYMENTS_DIR"

if ! stellar network ls | grep -qE "^${NETWORK_NAME}\b"; then
  stellar network add "$NETWORK_NAME" \
    --rpc-url "$NETWORK_RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE"
fi

if ! stellar keys ls | grep -qE "^${SOURCE_ACCOUNT}\b"; then
  fail "Production deployer keypair alias '$SOURCE_ACCOUNT' not found. Ensure the funded MainNet key is imported before deployment."
fi

rustup target add wasm32v1-none

cargo build \
  --manifest-path "$CONTRACTS_DIR/Cargo.toml" \
  --target wasm32v1-none \
  --release

WASM_PATH="$CONTRACTS_DIR/target/wasm32v1-none/release/nodezero_contracts.wasm"

if [[ ! -f "$WASM_PATH" ]]; then
  fail "WASM output not found at $WASM_PATH"
fi

IDENTITY_CONTRACT_ID="$(resolve_or_deploy_contract "$IDENTITY_ALIAS")"
LOCKBOX_CONTRACT_ID="$(resolve_or_deploy_contract "$LOCKBOX_ALIAS")"
LOCKBOX_FACTORY_CONTRACT_ID="$(resolve_or_deploy_contract "$LOCKBOX_FACTORY_ALIAS")"

STELLAR_CLI_VERSION="$(stellar --version 2>/dev/null || true)"

OUTPUT_FILE="$DEPLOYMENTS_DIR/stellar-mainnet.contracts.json"
STRICT_MAINNET_MODE="$([[ "$ALLOW_NON_MAINNET" == "1" ]] && echo "false" || echo "true")"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$OUTPUT_FILE" <<EOF
{
  "protocolMajor": "27",
  "stellarCliVersion": "$STELLAR_CLI_VERSION",
  "network": "$NETWORK_NAME",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "rpcUrl": "$NETWORK_RPC_URL",
  "sourceAccount": "$SOURCE_ACCOUNT",
  "strictMainnetMode": $STRICT_MAINNET_MODE,
  "contracts": {
    "identity": {
      "id": "$IDENTITY_CONTRACT_ID",
      "deploymentMode": "${CONTRACT_MODES[$IDENTITY_ALIAS]:-unknown}"
    },
    "lockbox": {
      "id": "$LOCKBOX_CONTRACT_ID",
      "deploymentMode": "${CONTRACT_MODES[$LOCKBOX_ALIAS]:-unknown}"
    },
    "lockboxFactory": {
      "id": "$LOCKBOX_FACTORY_CONTRACT_ID",
      "deploymentMode": "${CONTRACT_MODES[$LOCKBOX_FACTORY_ALIAS]:-unknown}"
    }
  },
  "generatedAt": "$GENERATED_AT"
}
EOF

echo "[mainnet-deploy] Wrote production deployment manifest: $OUTPUT_FILE"
