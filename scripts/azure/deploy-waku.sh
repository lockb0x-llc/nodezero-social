#!/usr/bin/env bash
set -euo pipefail

# Deploy the NodeZero self-hosted Waku node (nwaku) stack.
# Testnet-only. Mirrors the guardrail pattern of scripts/azure/deploy.sh and
# scripts/azure/deploy-solid-server.sh.
#
# Required environment variables:
#   AZURE_RESOURCE_GROUP   Target resource group.
#   AZURE_WAKU_NODEKEY     64-hex secp256k1 nodekey pinning the service node's
#                          peer id (and therefore NZ_WAKU_BOOTSTRAP_PEERS).
#                          Generate once with:
#                            openssl rand -hex 32
#                          Store it in the deployment secret store; NEVER
#                          commit it or place it in a parameters file.
# Optional:
#   AZURE_BICEP_PARAMETERS_FILE  Defaults to the staging-testnet parameters.
#   AZURE_ENVIRONMENT_NAME       Defaults to staging-testnet.
#   AZURE_WAKU_CUSTOM_DOMAIN     Overrides the parameters-file custom domain.
#   AZURE_WAKU_IMAGE             Overrides the pinned nwaku image.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
PARAM_FILE="${AZURE_BICEP_PARAMETERS_FILE:-$REPO_ROOT/infrastructure/azure/waku-node.parameters.staging-testnet.json}"
TEMPLATE_FILE="$REPO_ROOT/infrastructure/azure/waku-node.bicep"
TARGET_ENVIRONMENT="${AZURE_ENVIRONMENT_NAME:-staging-testnet}"
WAKU_NODEKEY="${AZURE_WAKU_NODEKEY:-}"
WAKU_CUSTOM_DOMAIN="${AZURE_WAKU_CUSTOM_DOMAIN:-}"
WAKU_IMAGE="${AZURE_WAKU_IMAGE:-}"

az_path() {
  local input_path="$1"
  if [[ "$input_path" =~ ^/mnt/([a-zA-Z])/(.*)$ ]]; then
    local drive="${BASH_REMATCH[1]}"
    local remainder="${BASH_REMATCH[2]}"
    remainder="${remainder//\//\\}"
    printf '%s:\\%s' "${drive^^}" "$remainder"
    return
  fi
  if command -v cygpath >/dev/null 2>&1; then
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        cygpath -w "$input_path"
        return
        ;;
    esac
  fi
  printf '%s' "$input_path"
}

AZ_PARAM_FILE="$(az_path "$PARAM_FILE")"
AZ_TEMPLATE_FILE="$(az_path "$TEMPLATE_FILE")"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd az
require_cmd node

if [[ -z "$RESOURCE_GROUP" ]]; then
  echo "AZURE_RESOURCE_GROUP is required."
  exit 1
fi

if [[ ! -f "$PARAM_FILE" ]]; then
  echo "Parameters file not found: $PARAM_FILE"
  exit 1
fi

if [[ "$PARAM_FILE" == *"example"* ]]; then
  echo "Refusing to deploy with an example parameters file: $PARAM_FILE"
  exit 1
fi

if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Template file not found: $TEMPLATE_FILE"
  exit 1
fi

if [[ "$TARGET_ENVIRONMENT" == "production-mainnet" ]]; then
  echo "Refusing production-mainnet deployment from the Waku staging script."
  exit 1
fi

if [[ "$TARGET_ENVIRONMENT" != "testnet" && "$TARGET_ENVIRONMENT" != "staging-testnet" ]]; then
  echo "Invalid AZURE_ENVIRONMENT_NAME '$TARGET_ENVIRONMENT'. This module is testnet-only."
  exit 1
fi

PARAM_ENVIRONMENT="$(node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(p?.parameters?.environmentName?.value ?? '')" "$PARAM_FILE")"
if [[ -z "$PARAM_ENVIRONMENT" ]]; then
  echo "Parameters file is missing parameters.environmentName.value."
  exit 1
fi

if [[ "$PARAM_ENVIRONMENT" != "$TARGET_ENVIRONMENT" ]]; then
  echo "Environment mismatch: AZURE_ENVIRONMENT_NAME='$TARGET_ENVIRONMENT' but parameters file environmentName='$PARAM_ENVIRONMENT'."
  exit 1
fi

# The nodekey pins the bootstrap peer id. It is a secret and must never live
# in a parameters file — supply it via the environment only.
if node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.exit(p?.parameters?.wakuNodeKey ? 0 : 1)" "$PARAM_FILE" >/dev/null 2>&1; then
  echo "Parameters file must not contain wakuNodeKey. Supply it via AZURE_WAKU_NODEKEY."
  exit 1
fi

if [[ -z "$WAKU_NODEKEY" ]]; then
  echo "AZURE_WAKU_NODEKEY is required (64-hex secp256k1 key; generate with 'openssl rand -hex 32')."
  exit 1
fi

if [[ ! "$WAKU_NODEKEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "AZURE_WAKU_NODEKEY must be exactly 64 hexadecimal characters."
  exit 1
fi

PARAM_OVERRIDES=("wakuNodeKey=$WAKU_NODEKEY")

if [[ -n "$WAKU_CUSTOM_DOMAIN" ]]; then
  if [[ "$WAKU_CUSTOM_DOMAIN" == *"://"* || "$WAKU_CUSTOM_DOMAIN" == */* ]]; then
    echo "AZURE_WAKU_CUSTOM_DOMAIN must be a bare hostname (for example, waku-staging.nodezero.social)."
    exit 1
  fi
  PARAM_OVERRIDES+=("wakuCustomDomain=$WAKU_CUSTOM_DOMAIN")
fi

if [[ -n "$WAKU_IMAGE" ]]; then
  PARAM_OVERRIDES+=("nwakuImage=$WAKU_IMAGE")
fi

PARAM_CUSTOM_DOMAIN="$(node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const v = p?.parameters?.wakuCustomDomain?.value ?? ''; console.log(String(v).trim());" "$PARAM_FILE")"
EFFECTIVE_CUSTOM_DOMAIN="${WAKU_CUSTOM_DOMAIN:-$PARAM_CUSTOM_DOMAIN}"

# Staging isolation: the staging Waku host must never be a production host.
EFFECTIVE_CUSTOM_DOMAIN_LOWER="${EFFECTIVE_CUSTOM_DOMAIN,,}"
if [[ "$TARGET_ENVIRONMENT" == "staging-testnet" || "$TARGET_ENVIRONMENT" == "testnet" ]]; then
  case "$EFFECTIVE_CUSTOM_DOMAIN_LOWER" in
    waku.nodezero.social|nodezero.social|www.nodezero.social)
      echo "Environment isolation violation: staging Waku deploy must not target production host '$EFFECTIVE_CUSTOM_DOMAIN'."
      exit 1
      ;;
  esac
fi

if ! az account show >/dev/null 2>&1; then
  echo "Azure CLI is not authenticated. Run 'az login' first."
  exit 1
fi

if ! az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "Resource group '$RESOURCE_GROUP' does not exist or is inaccessible."
  exit 1
fi

echo "Running preflight what-if for environment '$TARGET_ENVIRONMENT'..."
az deployment group what-if \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$AZ_TEMPLATE_FILE" \
  --parameters "@$AZ_PARAM_FILE" \
  "${PARAM_OVERRIDES[@]}" \
  --result-format ResourceIdOnly

echo "Applying deployment for environment '$TARGET_ENVIRONMENT'..."
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$AZ_TEMPLATE_FILE" \
  --parameters "@$AZ_PARAM_FILE" \
  "${PARAM_OVERRIDES[@]}" \
  --query "properties.outputs" \
  -o json

CONTAINER_APP_NAME="nz-${TARGET_ENVIRONMENT}-waku"

if [[ -n "$EFFECTIVE_CUSTOM_DOMAIN" ]]; then
  echo "Ensuring custom domain binding for '$EFFECTIVE_CUSTOM_DOMAIN' on Container App '$CONTAINER_APP_NAME'..."

  MANAGED_ENV_ID="$(az containerapp show --resource-group "$RESOURCE_GROUP" --name "$CONTAINER_APP_NAME" --query "properties.managedEnvironmentId" -o tsv | tr -d '\r')"
  if [[ -z "$MANAGED_ENV_ID" ]]; then
    echo "Unable to resolve managed environment for container app '$CONTAINER_APP_NAME'."
    exit 1
  fi
  MANAGED_ENV_NAME="${MANAGED_ENV_ID##*/}"

  CERT_NAME="$(az containerapp env certificate list --resource-group "$RESOURCE_GROUP" --name "$MANAGED_ENV_NAME" --query "[?properties.subjectName=='$EFFECTIVE_CUSTOM_DOMAIN' && properties.provisioningState=='Succeeded'].name | [0]" -o tsv | tr -d '\r')"
  if [[ -z "$CERT_NAME" ]]; then
    CERT_NAME="$(printf 'waku-%s-cert' "$EFFECTIVE_CUSTOM_DOMAIN" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | cut -c1-60)"
    echo "Creating managed certificate '$CERT_NAME' for '$EFFECTIVE_CUSTOM_DOMAIN'..."
    az containerapp env certificate create \
      --resource-group "$RESOURCE_GROUP" \
      --name "$MANAGED_ENV_NAME" \
      --certificate-name "$CERT_NAME" \
      --hostname "$EFFECTIVE_CUSTOM_DOMAIN" \
      --validation-method CNAME \
      -o none
  else
    echo "Reusing existing managed certificate '$CERT_NAME'."
  fi

  az containerapp hostname bind \
    --resource-group "$RESOURCE_GROUP" \
    --name "$CONTAINER_APP_NAME" \
    --environment "$MANAGED_ENV_NAME" \
    --hostname "$EFFECTIVE_CUSTOM_DOMAIN" \
    --certificate "$CERT_NAME" \
    -o none

  echo "Custom domain binding ensured for '$EFFECTIVE_CUSTOM_DOMAIN'."
fi

# ── Post-deploy health evidence ──────────────────────────────────────────────
# 1. Peer id: extract from container logs (REST is never publicly exposed).
#    The nodekey is pinned, so the peer id is stable — this becomes the /p2p/
#    suffix of NZ_WAKU_BOOTSTRAP_PEERS.
echo "Extracting service node peer id from container logs..."
PEER_ID=""
for attempt in $(seq 1 12); do
  PEER_ID="$(az containerapp logs show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$CONTAINER_APP_NAME" \
    --container nwaku \
    --tail 200 2>/dev/null \
    | grep -oE '16Uiu2HA[A-Za-z0-9]+' | head -1 || true)"
  if [[ -n "$PEER_ID" ]]; then
    break
  fi
  sleep 10
done

FQDN="$(az containerapp show --resource-group "$RESOURCE_GROUP" --name "$CONTAINER_APP_NAME" --query "properties.configuration.ingress.fqdn" -o tsv | tr -d '\r')"
BOOTSTRAP_HOST="${EFFECTIVE_CUSTOM_DOMAIN:-$FQDN}"

if [[ -z "$PEER_ID" ]]; then
  echo "WARNING: could not extract the peer id from logs yet. Re-run:"
  echo "  az containerapp logs show -g $RESOURCE_GROUP -n $CONTAINER_APP_NAME --container nwaku --tail 200 | grep -oE '16Uiu2HA[A-Za-z0-9]+' | head -1"
else
  echo ""
  echo "NZ_WAKU_BOOTSTRAP_PEERS=/dns4/${BOOTSTRAP_HOST}/tcp/443/wss/p2p/${PEER_ID}"
  echo ""
fi

# 2. Ingress reachability: a plain HTTPS GET against the WebSocket port must
#    answer (any HTTP status proves TLS + ingress + container liveness).
echo "Checking wss ingress reachability on https://${BOOTSTRAP_HOST}/ ..."
HTTP_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://${BOOTSTRAP_HOST}/" || true)"
if [[ "$HTTP_STATUS" == "000" ]]; then
  echo "WARNING: no HTTPS response from ${BOOTSTRAP_HOST} yet (DNS/cert propagation may be pending)."
else
  echo "Ingress responded with HTTP ${HTTP_STATUS} (container reachable through TLS ingress)."
fi

echo "Waku node deployment complete for environment '$TARGET_ENVIRONMENT'."
