#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# setup-treasury-deployer.sh
#
# One-time (idempotent) live TestNet setup for the two-account funding model:
#
#   TREASURY  (nodezero-testnet-treasury)         — canonical money source.
#   DEPLOYER  (nodezero-testnet-lockbox-deployer)  — lockb0x factory operator.
#
# It creates + Friendbot-funds both keys, deploys a FRESH Lockb0xFactory with the
# Deployer as operator, and emits the new public identifiers. Secrets are NEVER
# written to the repo or echoed; when STORE_SECRETS_IN_KEYVAULT=1 they are piped
# directly into Azure Key Vault.
#
# Requirements (fail-closed):
#   - Stellar CLI v27 on PATH (see install note printed below if missing).
#   - Rust toolchain with wasm32v1-none target (for the contract build).
#   - TestNet only. This script refuses any non-testnet network.
#
# Usage:
#   bash scripts/stellar/setup-treasury-deployer.sh
#   STORE_SECRETS_IN_KEYVAULT=1 KEY_VAULT_NAME=nodezerosocialstagingtes \
#     bash scripts/stellar/setup-treasury-deployer.sh
# ─────────────────────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/packages/contracts"
DEPLOYMENTS_DIR="$REPO_ROOT/deployments"

NETWORK_NAME="${STELLAR_NETWORK_NAME:-testnet}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
NETWORK_RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"

TREASURY_ALIAS="${TREASURY_ALIAS:-nodezero-testnet-treasury}"
DEPLOYER_ALIAS="${DEPLOYER_ALIAS:-nodezero-testnet-lockbox-deployer}"
FACTORY_ALIAS="${FACTORY_ALIAS:-nodezero-lockbox-factory-testnet-v2}"

STORE_SECRETS_IN_KEYVAULT="${STORE_SECRETS_IN_KEYVAULT:-0}"
KEY_VAULT_NAME="${KEY_VAULT_NAME:-nodezerosocialstagingtes}"

EXPECTED_TESTNET_NAME="testnet"
EXPECTED_TESTNET_PASSPHRASE="Test SDF Network ; September 2015"
EXPECTED_TESTNET_RPC_URL="https://soroban-testnet.stellar.org"

fail() { echo "[setup] ERROR: $1" >&2; exit 1; }
log() { echo "[setup] $1"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

# ── Strict TestNet invariants (mirrors scripts/stellar/deploy-testnet.sh) ─────
[[ "$NETWORK_NAME" == "$EXPECTED_TESTNET_NAME" ]] \
  || fail "Refusing: STELLAR_NETWORK_NAME must be '$EXPECTED_TESTNET_NAME' (got '$NETWORK_NAME')."
[[ "$NETWORK_PASSPHRASE" == "$EXPECTED_TESTNET_PASSPHRASE" ]] \
  || fail "Refusing: STELLAR_NETWORK_PASSPHRASE does not match the Stellar TestNet passphrase."
[[ "$NETWORK_RPC_URL" == "$EXPECTED_TESTNET_RPC_URL" ]] \
  || fail "Refusing: STELLAR_RPC_URL must be '$EXPECTED_TESTNET_RPC_URL' (got '$NETWORK_RPC_URL')."

if ! command -v stellar >/dev/null 2>&1; then
  cat >&2 <<'EOF'
[setup] ERROR: the `stellar` CLI (v27) is not on PATH.

Install the pinned Windows build (verify the sha256), then re-run:
  URL   : https://github.com/stellar/stellar-cli/releases/download/v27.0.0/stellar-cli-27.0.0-x86_64-pc-windows-msvc.tar.gz
  SHA256: 4b52649dbad0288e91d73228cb134096a4e9f5fc5b3a480c685873a45f0ad863

Linux/macOS builds are on the same release page. See also packages/jss-provisioner/startup.sh.
EOF
  exit 1
fi

require_cmd cargo
require_cmd rustup
if [[ "$STORE_SECRETS_IN_KEYVAULT" == "1" ]]; then
  require_cmd az
fi

log "Stellar CLI: $(stellar --version | head -n1)"

# ── Network config ───────────────────────────────────────────────────────────
if ! stellar network ls | grep -qE "^${NETWORK_NAME}\b"; then
  log "Adding stellar network config for ${NETWORK_NAME}"
  stellar network add "$NETWORK_NAME" --rpc-url "$NETWORK_RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE"
fi

# ── Create + fund keys (idempotent) ──────────────────────────────────────────
ensure_key() {
  local alias="$1"
  if stellar keys ls | grep -qE "^${alias}\b"; then
    log "Key '${alias}' already exists; leaving as-is."
  else
    log "Generating and funding key '${alias}' via Friendbot"
    stellar keys generate "$alias" --network "$NETWORK_NAME" --fund
  fi
}

ensure_key "$TREASURY_ALIAS"
ensure_key "$DEPLOYER_ALIAS"

TREASURY_PUBKEY="$(stellar keys public-key "$TREASURY_ALIAS")"
DEPLOYER_PUBKEY="$(stellar keys public-key "$DEPLOYER_ALIAS")"
log "Treasury public key: $TREASURY_PUBKEY"
log "Deployer public key: $DEPLOYER_PUBKEY"

# ── Build the contracts wasm + resolve the lockb0x wasm hash ─────────────────
log "Building contracts (wasm32v1-none, release)"
rustup target add wasm32v1-none >/dev/null 2>&1 || true
cargo build --manifest-path "$CONTRACTS_DIR/Cargo.toml" --target wasm32v1-none --release
WASM_PATH="$CONTRACTS_DIR/target/wasm32v1-none/release/nodezero_contracts.wasm"
[[ -f "$WASM_PATH" ]] || fail "WASM output not found at $WASM_PATH"

log "Uploading contract wasm to resolve its hash (idempotent)"
UPLOAD_OUT="$(stellar contract upload --wasm "$WASM_PATH" --source-account "$DEPLOYER_ALIAS" --network "$NETWORK_NAME")"
LOCKBOX_WASM_HASH="$(echo "$UPLOAD_OUT" | tr -cd '[:xdigit:]' | tr '[:upper:]' '[:lower:]' | tail -c 65)"
[[ ${#LOCKBOX_WASM_HASH} -eq 64 ]] || fail "Could not parse wasm hash from upload output: $UPLOAD_OUT"
log "Lockb0x wasm hash: $LOCKBOX_WASM_HASH"

# ── Deploy a FRESH factory with the Deployer as operator ─────────────────────
NEW_FACTORY_ID="$(stellar contract id --network "$NETWORK_NAME" --alias "$FACTORY_ALIAS" 2>/dev/null || true)"
if [[ -z "$NEW_FACTORY_ID" ]]; then
  log "Deploying fresh Lockb0xFactory (source = Deployer)"
  NEW_FACTORY_ID="$(stellar contract deploy --wasm-hash "$LOCKBOX_WASM_HASH" \
    --source-account "$DEPLOYER_ALIAS" --network "$NETWORK_NAME" --alias "$FACTORY_ALIAS")"
else
  log "Reusing existing factory alias '${FACTORY_ALIAS}': $NEW_FACTORY_ID"
fi
log "New factory contract ID: $NEW_FACTORY_ID"

# initialize_factory is one-time; ignore an "already initialised" error on re-run.
log "Initializing factory with Deployer as operator"
if ! stellar contract invoke --id "$NEW_FACTORY_ID" --network "$NETWORK_NAME" \
  --source-account "$DEPLOYER_ALIAS" -- \
  initialize_factory --operator "$DEPLOYER_PUBKEY" --lockbox_wasm_hash "$LOCKBOX_WASM_HASH" >/dev/null 2>&1; then
  log "initialize_factory returned non-zero (likely already initialised) — continuing."
fi

FACTORY_OPERATOR="$(stellar contract invoke --id "$NEW_FACTORY_ID" --network "$NETWORK_NAME" \
  --source-account "$DEPLOYER_ALIAS" -- get_factory_operator 2>/dev/null | tr -d '"' | tr -cd '[:alnum:]' || true)"
log "Factory operator (on-chain): $FACTORY_OPERATOR"
if [[ -n "$FACTORY_OPERATOR" && "$FACTORY_OPERATOR" != "$DEPLOYER_PUBKEY" ]]; then
  fail "Factory operator ($FACTORY_OPERATOR) does not match Deployer ($DEPLOYER_PUBKEY). Aborting."
fi

# ── Emit PUBLIC identifiers (no secrets) ─────────────────────────────────────
mkdir -p "$DEPLOYMENTS_DIR"
OUT_FILE="$DEPLOYMENTS_DIR/treasury-deployer.public.json"
cat > "$OUT_FILE" <<EOF
{
  "network": "$NETWORK_NAME",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "rpcUrl": "$NETWORK_RPC_URL",
  "treasury": { "alias": "$TREASURY_ALIAS", "publicKey": "$TREASURY_PUBKEY" },
  "deployer": { "alias": "$DEPLOYER_ALIAS", "publicKey": "$DEPLOYER_PUBKEY" },
  "lockboxFactory": {
    "alias": "$FACTORY_ALIAS",
    "id": "$NEW_FACTORY_ID",
    "operator": "$DEPLOYER_PUBKEY",
    "lockboxWasmHash": "$LOCKBOX_WASM_HASH"
  },
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
log "Wrote public identifiers to $OUT_FILE (no secrets)."

# ── Optionally store secrets in Key Vault (never echoed) ─────────────────────
if [[ "$STORE_SECRETS_IN_KEYVAULT" == "1" ]]; then
  log "Storing Treasury/Deployer secrets in Key Vault '$KEY_VAULT_NAME' (values not printed)"
  TREASURY_SECRET="$(stellar keys secret "$TREASURY_ALIAS" 2>/dev/null || stellar keys show "$TREASURY_ALIAS")"
  DEPLOYER_SECRET="$(stellar keys secret "$DEPLOYER_ALIAS" 2>/dev/null || stellar keys show "$DEPLOYER_ALIAS")"
  az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name stellar-treasury-secret --value "$TREASURY_SECRET" -o none
  az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name stellar-deployer-secret --value "$DEPLOYER_SECRET" -o none
  az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name stellar-lockbox-factory-v2-id --value "$NEW_FACTORY_ID" -o none
  unset TREASURY_SECRET DEPLOYER_SECRET
  log "Secrets stored. Repo contains only public identifiers."
else
  cat <<EOF

[setup] Next steps (run manually; secrets are NOT printed here):

  # 1) Store secrets in Key Vault (reads secrets into vars; nothing echoed):
  TREASURY_SECRET="\$(stellar keys secret $TREASURY_ALIAS)"
  DEPLOYER_SECRET="\$(stellar keys secret $DEPLOYER_ALIAS)"
  az keyvault secret set --vault-name $KEY_VAULT_NAME --name stellar-treasury-secret --value "\$TREASURY_SECRET" -o none
  az keyvault secret set --vault-name $KEY_VAULT_NAME --name stellar-deployer-secret --value "\$DEPLOYER_SECRET" -o none
  az keyvault secret set --vault-name $KEY_VAULT_NAME --name stellar-lockbox-factory-v2-id --value $NEW_FACTORY_ID -o none
  unset TREASURY_SECRET DEPLOYER_SECRET

  # 2) Point the provisioner at the new accounts + factory:
  az webapp config appsettings set \\
    --resource-group rg-nodezero-social-staging-testnet \\
    --name nodezero-social-staging-testnet-provisioner \\
    --settings \\
      JSS_TREASURY_SOURCE_ACCOUNT=$TREASURY_ALIAS \\
      JSS_DEPLOYER_SOURCE_ACCOUNT=$DEPLOYER_ALIAS \\
      JSS_LOCKBOX_FACTORY_CONTRACT_ID=$NEW_FACTORY_ID \\
      JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS=$DEPLOYER_PUBKEY \\
      JSS_LOCKBOX_WASM_HASH=$LOCKBOX_WASM_HASH

EOF
fi

log "Done. New factory: $NEW_FACTORY_ID (operator = Deployer $DEPLOYER_PUBKEY)."
