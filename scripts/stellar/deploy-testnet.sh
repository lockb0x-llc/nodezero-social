#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/packages/contracts"
DEPLOYMENTS_DIR="$REPO_ROOT/deployments"
NETWORK_NAME="${STELLAR_NETWORK_NAME:-testnet}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
NETWORK_RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
SOURCE_ACCOUNT="${STELLAR_SOURCE_ACCOUNT:-nodezero-testnet-deployer}"
IDENTITY_ALIAS="${STELLAR_IDENTITY_ALIAS:-nodezero-identity-testnet}"
LOCKBOX_ALIAS="${STELLAR_LOCKBOX_ALIAS:-nodezero-lockbox-testnet}"
LOCKBOX_FACTORY_ALIAS="${STELLAR_LOCKBOX_FACTORY_ALIAS:-nodezero-lockbox-factory-testnet}"
ALLOW_NON_TESTNET="${ALLOW_NON_TESTNET:-0}"
AUTO_FUND_SOURCE_ACCOUNT="${AUTO_FUND_SOURCE_ACCOUNT:-0}"

EXPECTED_TESTNET_NAME="testnet"
EXPECTED_TESTNET_PASSPHRASE="Test SDF Network ; September 2015"
EXPECTED_TESTNET_RPC_URL="https://soroban-testnet.stellar.org"
declare -A CONTRACT_MODES
declare -A CONTRACT_INIT_PROOFS

fail() {
  echo "$1"
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

validate_testnet_invariants() {
  if [[ "$ALLOW_NON_TESTNET" == "1" ]]; then
    echo "WARNING: ALLOW_NON_TESTNET=1 set; bypassing strict testnet invariants."
    return
  fi

  if [[ "$NETWORK_NAME" != "$EXPECTED_TESTNET_NAME" ]]; then
    fail "Refusing deploy: STELLAR_NETWORK_NAME must be '$EXPECTED_TESTNET_NAME' (got '$NETWORK_NAME')."
  fi

  if [[ "$NETWORK_PASSPHRASE" != "$EXPECTED_TESTNET_PASSPHRASE" ]]; then
    fail "Refusing deploy: STELLAR_NETWORK_PASSPHRASE does not match the Stellar TestNet passphrase."
  fi

  if [[ "$NETWORK_RPC_URL" != "$EXPECTED_TESTNET_RPC_URL" ]]; then
    fail "Refusing deploy: STELLAR_RPC_URL must be '$EXPECTED_TESTNET_RPC_URL' (got '$NETWORK_RPC_URL')."
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

require_lockbox_initialization_proof() {
  local contract_id="$1"
  local proof="${LOCKBOX_INITIALIZATION_PROOF:-}"

  if [[ -z "$contract_id" ]]; then
    fail "Lockb0x contract ID is missing; cannot record initialization proof."
  fi

  if [[ -z "$proof" ]]; then
    fail "Lockb0x initialization proof is required. Set LOCKBOX_INITIALIZATION_PROOF before deploying."
  fi

  CONTRACT_INIT_PROOFS["$LOCKBOX_ALIAS"]="$proof"
}

require_cmd cargo
require_cmd rustup
require_cmd stellar

require_stellar_cli_major_27
validate_testnet_invariants

mkdir -p "$DEPLOYMENTS_DIR"

if ! stellar network ls | grep -qE "^${NETWORK_NAME}\b"; then
  stellar network add "$NETWORK_NAME" \
    --rpc-url "$NETWORK_RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE"
fi

if ! stellar keys ls | grep -qE "^${SOURCE_ACCOUNT}\b"; then
  if [[ "$AUTO_FUND_SOURCE_ACCOUNT" != "1" ]]; then
    fail "Source account alias '$SOURCE_ACCOUNT' not found. Set AUTO_FUND_SOURCE_ACCOUNT=1 to auto-create and fund on TestNet."
  fi
  stellar keys generate "$SOURCE_ACCOUNT" --network "$NETWORK_NAME" --fund
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
require_lockbox_initialization_proof "$LOCKBOX_CONTRACT_ID"

STELLAR_CLI_VERSION="$(stellar --version 2>/dev/null || true)"

OUTPUT_FILE="$DEPLOYMENTS_DIR/stellar-testnet.contracts.json"
STRICT_TESTNET_MODE="$([[ "$ALLOW_NON_TESTNET" == "1" ]] && echo "false" || echo "true")"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$OUTPUT_FILE" <<EOF
{
  "protocolMajor": "27",
  "stellarCliVersion": "$STELLAR_CLI_VERSION",
  "network": "$NETWORK_NAME",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "rpcUrl": "$NETWORK_RPC_URL",
  "sourceAccount": "$SOURCE_ACCOUNT",
  "strictTestnetMode": $STRICT_TESTNET_MODE,
  "contracts": {
    "identity": {
      "id": "$IDENTITY_CONTRACT_ID",
      "deploymentMode": "${CONTRACT_MODES[$IDENTITY_ALIAS]:-unknown}"
    },
    "lockbox": {
      "id": "$LOCKBOX_CONTRACT_ID",
      "deploymentMode": "${CONTRACT_MODES[$LOCKBOX_ALIAS]:-unknown}",
      "initializationProof": "${CONTRACT_INIT_PROOFS[$LOCKBOX_ALIAS]:-missing}"
    },
    "lockboxFactory": {
      "id": "$LOCKBOX_FACTORY_CONTRACT_ID",
      "deploymentMode": "${CONTRACT_MODES[$LOCKBOX_FACTORY_ALIAS]:-unknown}"
    }
  },
  "generatedAt": "$GENERATED_AT"
}
EOF

echo "Wrote deployment manifest: $OUTPUT_FILE"
