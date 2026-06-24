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

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd cargo
require_cmd rustup
require_cmd stellar
require_cmd jq

mkdir -p "$DEPLOYMENTS_DIR"

if ! stellar network ls | grep -qE "^${NETWORK_NAME}\b"; then
  stellar network add "$NETWORK_NAME" \
    --rpc-url "$NETWORK_RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE"
fi

if ! stellar keys ls | grep -qE "^${SOURCE_ACCOUNT}\b"; then
  stellar keys generate "$SOURCE_ACCOUNT" --network "$NETWORK_NAME" --fund
fi

rustup target add wasm32v1-none

cargo build \
  --manifest-path "$CONTRACTS_DIR/Cargo.toml" \
  --target wasm32v1-none \
  --release

WASM_PATH="$CONTRACTS_DIR/target/wasm32v1-none/release/nodezero_contracts.wasm"

if [[ ! -f "$WASM_PATH" ]]; then
  echo "WASM output not found at $WASM_PATH"
  exit 1
fi

IDENTITY_CONTRACT_ID="$(
  stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source-account "$SOURCE_ACCOUNT" \
    --network "$NETWORK_NAME" \
    --alias "$IDENTITY_ALIAS"
)"

LOCKBOX_CONTRACT_ID="$(
  stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source-account "$SOURCE_ACCOUNT" \
    --network "$NETWORK_NAME" \
    --alias "$LOCKBOX_ALIAS"
)"

OUTPUT_FILE="$DEPLOYMENTS_DIR/stellar-testnet.contracts.json"
jq -n \
  --arg protocolMajor "27" \
  --arg network "$NETWORK_NAME" \
  --arg passphrase "$NETWORK_PASSPHRASE" \
  --arg rpcUrl "$NETWORK_RPC_URL" \
  --arg sourceAccount "$SOURCE_ACCOUNT" \
  --arg identityContractId "$IDENTITY_CONTRACT_ID" \
  --arg lockboxContractId "$LOCKBOX_CONTRACT_ID" \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    protocolMajor: $protocolMajor,
    network: $network,
    networkPassphrase: $passphrase,
    rpcUrl: $rpcUrl,
    sourceAccount: $sourceAccount,
    contracts: {
      identity: $identityContractId,
      lockbox: $lockboxContractId
    },
    generatedAt: $generatedAt
  }' > "$OUTPUT_FILE"

echo "Wrote deployment manifest: $OUTPUT_FILE"
