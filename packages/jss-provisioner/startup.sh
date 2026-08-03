#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[jss-provisioner-startup] $*"
}

APP_ROOT="${APP_ROOT:-/home/site/wwwroot}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_SCOPE="${JSS_LOCKBOX_FACTORY_BOOTSTRAP_ALIAS:-default}"
STATE_DIR="${HOME:-/home}/.nodezero-provisioner-${STATE_SCOPE}"
STATE_FILE="$STATE_DIR/soroban-bootstrap.env"
TOOLS_DIR="$STATE_DIR/tools"
STELLAR_BIN="$TOOLS_DIR/stellar"
STELLAR_URL="https://github.com/stellar/stellar-cli/releases/download/v27.0.0/stellar-cli-27.0.0-x86_64-unknown-linux-gnu.tar.gz"
STELLAR_ARCHIVE_SHA256="357bf712f6353c28cd33c794402a3c87231757a5b305e6ef1604365af4fdd556"
STELLAR_BINARY_SHA256="14a71be83c2f31686b2b32a2d302fd226e6872c1b46a9c23daaa693a9bf98d80"

. "$SCRIPT_DIR/install-stellar-cli.sh"

mkdir -p "$STATE_DIR" "$TOOLS_DIR"

if ! STELLAR_BIN="$(install_stellar_cli \
  "$TOOLS_DIR" \
  "$STELLAR_URL" \
  "$STELLAR_ARCHIVE_SHA256" \
  "$STELLAR_BINARY_SHA256")"; then
  log "Stellar CLI installation integrity verification failed"
  exit 1
fi

export PATH="$TOOLS_DIR:$PATH"

stellar() {
  "$STELLAR_BIN" "$@"
}

log "Stellar CLI: $(stellar --version | head -n1)"

NETWORK_NAME="testnet"
RPC_URL="${JSS_STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${JSS_STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
SOURCE_ALIAS="${JSS_STELLAR_BOOTSTRAP_ALIAS:-nodezero-staging-provisioner}"
BOOTSTRAP_ALIAS="${JSS_LOCKBOX_FACTORY_BOOTSTRAP_ALIAS:-nodezero-lockbox-factory-staging-bootstrap}"
REFERENCE_FACTORY_ID="${JSS_LOCKBOX_FACTORY_CONTRACT_ID:-${NZ_LOCKBOX_FACTORY_CONTRACT_ID:-}}"
BOOTSTRAP_ENABLED="${JSS_LOCKBOX_FACTORY_BOOTSTRAP_ENABLED:-false}"

if [[ -z "$REFERENCE_FACTORY_ID" ]]; then
  log "JSS_LOCKBOX_FACTORY_CONTRACT_ID (or NZ_LOCKBOX_FACTORY_CONTRACT_ID) is required"
  exit 1
fi

if ! stellar network ls | grep -qE "^${NETWORK_NAME}\\b"; then
  log "Adding stellar network config for ${NETWORK_NAME}"
  stellar network add "$NETWORK_NAME" --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE"
fi

# ── Model B: import canonical Treasury/Deployer keys from injected secrets ───
# Secrets are provided via Key Vault-backed app settings (JSS_TREASURY_SECRET,
# JSS_DEPLOYER_SECRET). Writing the identity toml directly is the reliable
# non-interactive import path. When a secret is absent, the legacy generated
# source account (below) is used instead, preserving backward compatibility.
TREASURY_ALIAS="${JSS_TREASURY_SOURCE_ACCOUNT:-nodezero-testnet-treasury}"
DEPLOYER_ALIAS="${JSS_DEPLOYER_SOURCE_ACCOUNT:-nodezero-testnet-lockbox-deployer}"
IDENTITY_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/stellar/identity"
mkdir -p "$IDENTITY_DIR"

import_key() {
  local alias="$1" secret="$2"
  if [[ -n "$secret" ]]; then
    printf 'secret_key = "%s"\n' "$secret" > "$IDENTITY_DIR/${alias}.toml"
    log "Imported key alias '${alias}' from injected secret."
  fi
}

import_key "$TREASURY_ALIAS" "${JSS_TREASURY_SECRET:-}"
import_key "$DEPLOYER_ALIAS" "${JSS_DEPLOYER_SECRET:-}"

if ! stellar keys ls | grep -qE "^${SOURCE_ALIAS}\\b"; then
  log "Generating and funding source identity ${SOURCE_ALIAS}"
  stellar keys generate "$SOURCE_ALIAS" --network "$NETWORK_NAME" --fund
fi

if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi

case "${BOOTSTRAP_ENABLED,,}" in
  true|1|yes)
    if [[ -z "${BOOTSTRAPPED_FACTORY_ID:-}" || -z "${BOOTSTRAPPED_OPERATOR_ADDRESS:-}" ]]; then
      log "Resolving wasm hash from reference factory ${REFERENCE_FACTORY_ID}"
      WASM_HASH_RAW="$(stellar contract info hash --contract-id "$REFERENCE_FACTORY_ID" --network "$NETWORK_NAME" 2>/dev/null || true)"
      WASM_HASH="$(echo "$WASM_HASH_RAW" | tr -cd '[:xdigit:]' | tr '[:upper:]' '[:lower:]' | tail -c 65)"

      if [[ ${#WASM_HASH} -ne 64 ]]; then
        log "Failed to parse wasm hash from reference factory"
        log "Raw output: $WASM_HASH_RAW"
        exit 1
      fi

      log "Deploying/reusing bootstrap factory alias ${BOOTSTRAP_ALIAS}"
      BOOTSTRAPPED_FACTORY_ID="$(stellar contract id --network "$NETWORK_NAME" --alias "$BOOTSTRAP_ALIAS" 2>/dev/null || true)"
      if [[ -z "$BOOTSTRAPPED_FACTORY_ID" ]]; then
        BOOTSTRAPPED_FACTORY_ID="$(stellar contract deploy --wasm-hash "$WASM_HASH" --source-account "$SOURCE_ALIAS" --network "$NETWORK_NAME" --alias "$BOOTSTRAP_ALIAS")"
      fi

      BOOTSTRAPPED_OPERATOR_ADDRESS="$(stellar keys public-key "$SOURCE_ALIAS")"

      log "Initializing bootstrap factory"
      stellar contract invoke \
        --id "$BOOTSTRAPPED_FACTORY_ID" \
        --network "$NETWORK_NAME" \
        --source-account "$SOURCE_ALIAS" \
        -- \
        initialize_factory \
        --operator "$BOOTSTRAPPED_OPERATOR_ADDRESS" \
        --lockbox_wasm_hash "$WASM_HASH" >/dev/null

      cat > "$STATE_FILE" <<EOF
BOOTSTRAPPED_FACTORY_ID=$BOOTSTRAPPED_FACTORY_ID
BOOTSTRAPPED_OPERATOR_ADDRESS=$BOOTSTRAPPED_OPERATOR_ADDRESS
BOOTSTRAPPED_SOURCE_ALIAS=$SOURCE_ALIAS
EOF
    fi

    export JSS_STELLAR_SOURCE_ACCOUNT="${BOOTSTRAPPED_SOURCE_ALIAS:-$SOURCE_ALIAS}"
    export JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS="$BOOTSTRAPPED_OPERATOR_ADDRESS"
    export JSS_LOCKBOX_FACTORY_CONTRACT_ID="$BOOTSTRAPPED_FACTORY_ID"
    ;;
  *)
    # Model B default: the Deployer is the factory operator + Soroban signer;
    # the Treasury funds member account creation, fee-bumps, and Deployer
    # top-ups. When the canonical keys were not injected, fall back to the
    # legacy generated source account so existing deployments keep working.
    export JSS_TREASURY_SOURCE_ACCOUNT="${JSS_TREASURY_SOURCE_ACCOUNT:-$SOURCE_ALIAS}"
    export JSS_DEPLOYER_SOURCE_ACCOUNT="${JSS_DEPLOYER_SOURCE_ACCOUNT:-$SOURCE_ALIAS}"
    export JSS_STELLAR_SOURCE_ACCOUNT="${JSS_STELLAR_SOURCE_ACCOUNT:-$JSS_DEPLOYER_SOURCE_ACCOUNT}"

    EFFECTIVE_DEPLOYER_PUBKEY="$(stellar keys public-key "$JSS_DEPLOYER_SOURCE_ACCOUNT")"
    export JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS="$EFFECTIVE_DEPLOYER_PUBKEY"
    export JSS_LOCKBOX_FACTORY_CONTRACT_ID="$REFERENCE_FACTORY_ID"
    ;;
esac

log "Using treasury alias: ${JSS_TREASURY_SOURCE_ACCOUNT:-<unset>}"
log "Using deployer alias: ${JSS_DEPLOYER_SOURCE_ACCOUNT:-<unset>}"
log "Using source alias: $JSS_STELLAR_SOURCE_ACCOUNT"
log "Using factory contract: $JSS_LOCKBOX_FACTORY_CONTRACT_ID"
log "Using operator address: $JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS"

cd "$APP_ROOT"
exec node dist/index.js