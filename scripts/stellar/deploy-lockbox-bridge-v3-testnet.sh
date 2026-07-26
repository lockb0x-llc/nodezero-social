#!/usr/bin/env bash
set -euo pipefail

# Publishes the NodeZero Lockb0x Bridge v3 contract set on Stellar Testnet.
# It is dry-run by default and refuses mismatched ZK verification-key inputs.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
V3_DIR="$REPO_ROOT/packages/contracts/bridge-v3"
OUTPUT_FILE="$REPO_ROOT/deployments/stellar-testnet.lockbox-bridge-v3.json"

NETWORK_NAME="${STELLAR_NETWORK_NAME:-testnet}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
NETWORK_RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
DEPLOYER_ALIAS="${DEPLOYER_ALIAS:-nodezero-testnet-lockbox-deployer}"
BRIDGE_ADMIN="${BRIDGE_ADMIN:-}"
BRIDGE_CIRCUIT_VERSION="${BRIDGE_CIRCUIT_VERSION:-1}"
BRIDGE_VK_FILE="${BRIDGE_VK_FILE:-}"
BRIDGE_VK_SHA256="${BRIDGE_VK_SHA256:-}"
EXECUTE_TESTNET="${EXECUTE_TESTNET:-0}"

fail() { echo "[bridge-v3] ERROR: $*" >&2; exit 1; }
log() { echo "[bridge-v3] $*"; }
first_contract_id() { grep -Eo 'C[A-Z0-9]{55}' | head -n1; }
first_hex64() { grep -Eo '[0-9a-fA-F]{64}' | head -n1 | tr '[:upper:]' '[:lower:]'; }

[[ "$NETWORK_NAME" == 'testnet' ]] || fail 'Only Testnet deployments are allowed by this script.'
[[ "$NETWORK_PASSPHRASE" == 'Test SDF Network ; September 2015' ]] || fail 'Testnet passphrase mismatch.'
[[ "$NETWORK_RPC_URL" == 'https://soroban-testnet.stellar.org' ]] || fail 'Testnet RPC URL mismatch.'
[[ "$BRIDGE_CIRCUIT_VERSION" =~ ^[1-9][0-9]*$ ]] || fail 'BRIDGE_CIRCUIT_VERSION must be a positive integer.'

command -v cargo >/dev/null || fail 'cargo is required.'
command -v stellar >/dev/null || fail 'stellar CLI is required.'
command -v sha256sum >/dev/null || fail 'sha256sum is required.'

if [[ -z "$BRIDGE_VK_FILE" || -z "$BRIDGE_VK_SHA256" ]]; then
  fail 'BRIDGE_VK_FILE and BRIDGE_VK_SHA256 are required for a reproducible V3 deployment.'
fi
[[ -f "$BRIDGE_VK_FILE" ]] || fail "Bridge verification-key file does not exist: $BRIDGE_VK_FILE"
[[ "$BRIDGE_VK_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || fail 'BRIDGE_VK_SHA256 must be a SHA-256 hex digest.'

ACTUAL_VK_SHA256="$(sha256sum "$BRIDGE_VK_FILE" | awk '{print tolower($1)}')"
[[ "$ACTUAL_VK_SHA256" == "${BRIDGE_VK_SHA256,,}" ]] || fail 'Bridge verification-key checksum mismatch.'

BRIDGE_VK_HEX="$(tr -d '[:space:]' < "$BRIDGE_VK_FILE" | tr '[:upper:]' '[:lower:]')"
[[ "$BRIDGE_VK_HEX" =~ ^[0-9a-f]+$ ]] || fail 'Bridge verification-key file must be raw binary encoded as hex.'
[[ $(( ${#BRIDGE_VK_HEX} % 2 )) -eq 0 ]] || fail 'Bridge verification-key hex length must be even.'

rustup target add wasm32v1-none >/dev/null
cargo build --manifest-path "$V3_DIR/Cargo.toml" --target wasm32v1-none --release

ACCOUNT_WASM="$V3_DIR/target/wasm32v1-none/release/nodezero_lockb0x_bridge_account.wasm"
FACTORY_WASM="$V3_DIR/target/wasm32v1-none/release/nodezero_lockb0x_bridge_factory.wasm"
VERIFIER_WASM="$V3_DIR/target/wasm32v1-none/release/nodezero_lockb0x_bridge_verifier.wasm"
[[ -f "$ACCOUNT_WASM" && -f "$FACTORY_WASM" && -f "$VERIFIER_WASM" ]] || fail 'Expected V3 WASM artifacts were not built.'

if [[ "$EXECUTE_TESTNET" != '1' ]]; then
  log 'Preflight passed. Set EXECUTE_TESTNET=1 after reviewing the VK checksum and Testnet source account.'
  log "Account WASM:  $(sha256sum "$ACCOUNT_WASM" | awk '{print $1}')"
  log "Factory WASM:  $(sha256sum "$FACTORY_WASM" | awk '{print $1}')"
  log "Verifier WASM: $(sha256sum "$VERIFIER_WASM" | awk '{print $1}')"
  exit 0
fi

[[ -n "$BRIDGE_ADMIN" ]] || fail 'BRIDGE_ADMIN is required when EXECUTE_TESTNET=1.'

if ! stellar network ls | grep -qE '^testnet\b'; then
  stellar network add testnet --rpc-url "$NETWORK_RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE"
fi

ACCOUNT_WASM_HASH="$(stellar contract upload --wasm "$ACCOUNT_WASM" --source-account "$DEPLOYER_ALIAS" --network testnet | first_hex64)"
[[ "$ACCOUNT_WASM_HASH" =~ ^[0-9a-f]{64}$ ]] || fail 'Could not parse account WASM hash from Stellar CLI output.'
VERIFIER_ID="$(stellar contract deploy --wasm "$VERIFIER_WASM" --source-account "$DEPLOYER_ALIAS" --network testnet -- \
  --admin "$BRIDGE_ADMIN" --verification_key "$BRIDGE_VK_HEX" --circuit_version "$BRIDGE_CIRCUIT_VERSION" | first_contract_id)"
[[ "$VERIFIER_ID" =~ ^C[A-Z0-9]{55}$ ]] || fail 'Could not parse Bridge Verifier contract ID from Stellar CLI output.'
FACTORY_ID="$(stellar contract deploy --wasm "$FACTORY_WASM" --source-account "$DEPLOYER_ALIAS" --network testnet -- \
  --admin "$BRIDGE_ADMIN" --account_wasm_hash "$ACCOUNT_WASM_HASH" | first_contract_id)"
[[ "$FACTORY_ID" =~ ^C[A-Z0-9]{55}$ ]] || fail 'Could not parse Bridge Factory contract ID from Stellar CLI output.'

mkdir -p "$(dirname "$OUTPUT_FILE")"
cat > "$OUTPUT_FILE" <<EOF
{
  "network": "testnet",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "circuitVersion": $BRIDGE_CIRCUIT_VERSION,
  "verificationKeySha256": "$ACTUAL_VK_SHA256",
  "accountWasmSha256": "$(sha256sum "$ACCOUNT_WASM" | awk '{print $1}')",
  "factoryWasmSha256": "$(sha256sum "$FACTORY_WASM" | awk '{print $1}')",
  "verifierWasmSha256": "$(sha256sum "$VERIFIER_WASM" | awk '{print $1}')",
  "accountWasmHash": "$ACCOUNT_WASM_HASH",
  "bridgeVerifierId": "$VERIFIER_ID",
  "bridgeFactoryId": "$FACTORY_ID"
}
EOF

log "Published Bridge V3 Testnet deployment metadata: $OUTPUT_FILE"