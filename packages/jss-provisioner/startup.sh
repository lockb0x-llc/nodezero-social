#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[jss-provisioner-startup] $*"
}

APP_ROOT="${APP_ROOT:-/home/site/wwwroot}"
STATE_SCOPE="${JSS_LOCKBOX_FACTORY_BOOTSTRAP_ALIAS:-default}"
STATE_DIR="${HOME:-/home}/.nodezero-provisioner-${STATE_SCOPE}"
STATE_FILE="$STATE_DIR/soroban-bootstrap.env"
TOOLS_DIR="$STATE_DIR/tools"
STELLAR_ARCHIVE="$TOOLS_DIR/stellar-cli.tar.gz"
STELLAR_URL="${JSS_STELLAR_CLI_URL:-https://github.com/stellar/stellar-cli/releases/download/v27.0.0/stellar-cli-27.0.0-x86_64-unknown-linux-gnu.tar.gz}"

mkdir -p "$STATE_DIR" "$TOOLS_DIR"

if ! command -v stellar >/dev/null 2>&1; then
  if [[ ! -f "$STELLAR_ARCHIVE" ]]; then
    log "Downloading Stellar CLI archive"
    curl -fsSL "$STELLAR_URL" -o "$STELLAR_ARCHIVE"
  fi

  if [[ ! -x "$TOOLS_DIR/stellar" ]]; then
    log "Extracting Stellar CLI"
    tar -xzf "$STELLAR_ARCHIVE" -C "$TOOLS_DIR"
    STELLAR_BIN="$(find "$TOOLS_DIR" -type f -name stellar | head -n1 || true)"
    if [[ -z "$STELLAR_BIN" ]]; then
      log "Failed to locate stellar binary after extraction"
      exit 1
    fi
    if [[ "$STELLAR_BIN" != "$TOOLS_DIR/stellar" ]]; then
      cp "$STELLAR_BIN" "$TOOLS_DIR/stellar"
    fi
    chmod +x "$TOOLS_DIR/stellar"
  fi

  export PATH="$TOOLS_DIR:$PATH"
fi

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
    # Default path: keep factory ID from env authoritative to prevent config drift.
    export JSS_STELLAR_SOURCE_ACCOUNT="${JSS_STELLAR_SOURCE_ACCOUNT:-$SOURCE_ALIAS}"

    EFFECTIVE_SOURCE_PUBKEY="$(stellar keys public-key "$JSS_STELLAR_SOURCE_ACCOUNT")"
    CONFIGURED_OPERATOR_ADDRESS="${JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS:-}"
    if [[ -n "$CONFIGURED_OPERATOR_ADDRESS" && "$CONFIGURED_OPERATOR_ADDRESS" != "$EFFECTIVE_SOURCE_PUBKEY" ]]; then
      log "Configured operator address does not match source key; overriding to source public key"
    fi

    export JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS="$EFFECTIVE_SOURCE_PUBKEY"
    export JSS_LOCKBOX_FACTORY_CONTRACT_ID="$REFERENCE_FACTORY_ID"
    ;;
esac

log "Using source alias: $JSS_STELLAR_SOURCE_ACCOUNT"
log "Using factory contract: $JSS_LOCKBOX_FACTORY_CONTRACT_ID"
log "Using operator address: $JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS"

cd "$APP_ROOT"
exec node dist/index.js