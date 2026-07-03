#!/usr/bin/env bash
set -euo pipefail

# Idempotent redeploy + custom-domain remediation for NodeZero Solid Server (CSS).
# Safe for repeated execution in testnet/staging-testnet.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
PARAM_FILE="${AZURE_BICEP_PARAMETERS_FILE:-$REPO_ROOT/infrastructure/azure/solid-server.parameters.staging-testnet.json}"
TARGET_ENVIRONMENT="${AZURE_ENVIRONMENT_NAME:-staging-testnet}"

# Optional runtime overrides passed through to deploy-solid-server.sh
CSS_CONFIG_ARG="${AZURE_CSS_CONFIG_ARG:-}"
CSS_DATA_PATH="${AZURE_CSS_DATA_PATH:-}"
CSS_EXTRA_ARGS_JSON="${AZURE_CSS_EXTRA_ARGS_JSON:-}"
CSS_IMAGE="${AZURE_SOLID_CSS_IMAGE:-}"
CSS_IMAGE_REGISTRY_SERVER="${AZURE_SOLID_CSS_IMAGE_REGISTRY_SERVER:-}"
CSS_IMAGE_REGISTRY_USERNAME="${AZURE_SOLID_CSS_IMAGE_REGISTRY_USERNAME:-}"
CSS_IMAGE_REGISTRY_PASSWORD="${AZURE_SOLID_CSS_IMAGE_REGISTRY_PASSWORD:-}"
EMAIL_PROVIDER_MODE="${AZURE_SOLID_EMAIL_PROVIDER_MODE:-}"
EMAIL_FROM_ADDRESS="${AZURE_SOLID_EMAIL_FROM_ADDRESS:-}"
EMAIL_FROM_NAME="${AZURE_SOLID_EMAIL_FROM_NAME:-}"
SMTP_HOST="${AZURE_SOLID_SMTP_HOST:-}"
SMTP_PORT="${AZURE_SOLID_SMTP_PORT:-}"
SMTP_STARTTLS="${AZURE_SOLID_SMTP_STARTTLS:-}"
SMTP_USERNAME="${AZURE_SOLID_SMTP_USERNAME:-}"
SMTP_PASSWORD="${AZURE_SOLID_SMTP_PASSWORD:-}"

# Optional DNS remediation (disabled by default).
# When true and a custom domain is used, enforce CNAME host -> ACA FQDN.
DNS_AUTOFIX="${AZURE_SOLID_DNS_AUTOFIX:-false}"
DNS_ZONE_NAME="${AZURE_SOLID_DNS_ZONE_NAME:-}"
DNS_RESOURCE_GROUP="${AZURE_SOLID_DNS_RESOURCE_GROUP:-$RESOURCE_GROUP}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

trim_cli_output() {
  printf '%s' "$1" | tr -d '\r\n'
}

extract_host_from_url() {
  node -e "const u = new URL(process.argv[1]); process.stdout.write(u.host.toLowerCase());" "$1"
}

extract_subdomain_label() {
  local fqdn="$1"
  local zone="$2"
  if [[ "$fqdn" == *".$zone" ]]; then
    local label="${fqdn%.${zone}}"
    printf '%s' "$label"
    return
  fi
  echo ""
}

require_cmd az
require_cmd node
require_cmd curl

if [[ -z "$RESOURCE_GROUP" ]]; then
  echo "AZURE_RESOURCE_GROUP is required."
  exit 1
fi

if [[ ! -f "$PARAM_FILE" ]]; then
  echo "Parameters file not found: $PARAM_FILE"
  exit 1
fi

if [[ "$TARGET_ENVIRONMENT" != "testnet" && "$TARGET_ENVIRONMENT" != "staging-testnet" ]]; then
  echo "Invalid AZURE_ENVIRONMENT_NAME '$TARGET_ENVIRONMENT'. This script is testnet-only."
  exit 1
fi

if ! az account show >/dev/null 2>&1; then
  echo "Azure CLI is not authenticated. Run 'az login' first."
  exit 1
fi

if ! az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "Resource group '$RESOURCE_GROUP' does not exist or is inaccessible."
  exit 1
fi

echo "Running idempotent Solid redeploy for '$TARGET_ENVIRONMENT'..."
AZURE_RESOURCE_GROUP="$RESOURCE_GROUP" \
AZURE_BICEP_PARAMETERS_FILE="$PARAM_FILE" \
AZURE_ENVIRONMENT_NAME="$TARGET_ENVIRONMENT" \
AZURE_CSS_CONFIG_ARG="$CSS_CONFIG_ARG" \
AZURE_CSS_DATA_PATH="$CSS_DATA_PATH" \
AZURE_CSS_EXTRA_ARGS_JSON="$CSS_EXTRA_ARGS_JSON" \
AZURE_SOLID_CSS_IMAGE="$CSS_IMAGE" \
AZURE_SOLID_CSS_IMAGE_REGISTRY_SERVER="$CSS_IMAGE_REGISTRY_SERVER" \
AZURE_SOLID_CSS_IMAGE_REGISTRY_USERNAME="$CSS_IMAGE_REGISTRY_USERNAME" \
AZURE_SOLID_CSS_IMAGE_REGISTRY_PASSWORD="$CSS_IMAGE_REGISTRY_PASSWORD" \
AZURE_SOLID_EMAIL_PROVIDER_MODE="$EMAIL_PROVIDER_MODE" \
AZURE_SOLID_EMAIL_FROM_ADDRESS="$EMAIL_FROM_ADDRESS" \
AZURE_SOLID_EMAIL_FROM_NAME="$EMAIL_FROM_NAME" \
AZURE_SOLID_SMTP_HOST="$SMTP_HOST" \
AZURE_SOLID_SMTP_PORT="$SMTP_PORT" \
AZURE_SOLID_SMTP_STARTTLS="$SMTP_STARTTLS" \
AZURE_SOLID_SMTP_USERNAME="$SMTP_USERNAME" \
AZURE_SOLID_SMTP_PASSWORD="$SMTP_PASSWORD" \
"$REPO_ROOT/scripts/azure/deploy-solid-server.sh"

DEPLOY_NAME="solid-server"
CONTAINER_APP_NAME_RAW="$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOY_NAME" --query "properties.outputs.containerAppName.value" -o tsv)"
CSS_BASE_URL_RAW="$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOY_NAME" --query "properties.outputs.cssBaseUrl.value" -o tsv)"
CSS_FQDN_RAW="$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOY_NAME" --query "properties.outputs.cssFqdn.value" -o tsv)"

CONTAINER_APP_NAME="$(trim_cli_output "$CONTAINER_APP_NAME_RAW")"
CSS_BASE_URL="$(trim_cli_output "$CSS_BASE_URL_RAW")"
CSS_FQDN="$(trim_cli_output "$CSS_FQDN_RAW")"

if [[ -z "$CONTAINER_APP_NAME" || -z "$CSS_BASE_URL" || -z "$CSS_FQDN" ]]; then
  echo "Unable to resolve deployment outputs from deployment '$DEPLOY_NAME'."
  exit 1
fi

MANAGED_ENV_ID_RAW="$(az containerapp show --resource-group "$RESOURCE_GROUP" --name "$CONTAINER_APP_NAME" --query "properties.managedEnvironmentId" -o tsv)"
MANAGED_ENV_ID="$(trim_cli_output "$MANAGED_ENV_ID_RAW")"
MANAGED_ENV_NAME="${MANAGED_ENV_ID##*/}"

CUSTOM_HOST="$(extract_host_from_url "$CSS_BASE_URL")"
DEFAULT_HOST="${CSS_FQDN,,}"

if [[ "$CUSTOM_HOST" != "$DEFAULT_HOST" ]]; then
  echo "Custom domain configured: $CUSTOM_HOST"

  if [[ "$DNS_AUTOFIX" == "true" ]]; then
    if [[ -z "$DNS_ZONE_NAME" ]]; then
      echo "AZURE_SOLID_DNS_ZONE_NAME is required when AZURE_SOLID_DNS_AUTOFIX=true."
      exit 1
    fi

    RECORD_LABEL="$(extract_subdomain_label "$CUSTOM_HOST" "$DNS_ZONE_NAME")"
    if [[ -z "$RECORD_LABEL" ]]; then
      echo "Cannot derive DNS record label from custom host '$CUSTOM_HOST' and zone '$DNS_ZONE_NAME'."
      exit 1
    fi

    CURRENT_CNAME_RAW="$(az network dns record-set cname show --resource-group "$DNS_RESOURCE_GROUP" --zone-name "$DNS_ZONE_NAME" --name "$RECORD_LABEL" --query "CNAMERecord.cname" -o tsv 2>/dev/null || true)"
    CURRENT_CNAME="$(trim_cli_output "$CURRENT_CNAME_RAW")"
    if [[ "$CURRENT_CNAME" != "$CSS_FQDN" ]]; then
      echo "Updating DNS CNAME $RECORD_LABEL.$DNS_ZONE_NAME -> $CSS_FQDN"
      az network dns record-set cname set-record \
        --resource-group "$DNS_RESOURCE_GROUP" \
        --zone-name "$DNS_ZONE_NAME" \
        --record-set-name "$RECORD_LABEL" \
        --cname "$CSS_FQDN" \
        --ttl 300 \
        -o none
    else
      echo "DNS CNAME already correct."
    fi
  fi

  CERT_NAME_RAW="$(az containerapp env certificate list --resource-group "$RESOURCE_GROUP" --name "$MANAGED_ENV_NAME" --query "[?properties.subjectName=='$CUSTOM_HOST' && properties.provisioningState=='Succeeded'].name | [0]" -o tsv)"
  CERT_NAME="$(trim_cli_output "$CERT_NAME_RAW")"
  if [[ -z "$CERT_NAME" ]]; then
    CERT_NAME="solid-${CUSTOM_HOST//./-}-cert"
    CERT_NAME="${CERT_NAME:0:60}"
    echo "Creating managed certificate '$CERT_NAME' for $CUSTOM_HOST"
    az containerapp env certificate create \
      --resource-group "$RESOURCE_GROUP" \
      --name "$MANAGED_ENV_NAME" \
      --certificate-name "$CERT_NAME" \
      --hostname "$CUSTOM_HOST" \
      --validation-method CNAME \
      -o none
  else
    echo "Reusing existing managed certificate '$CERT_NAME'."
  fi

  echo "Ensuring hostname binding for $CUSTOM_HOST"
  az containerapp hostname bind \
    --resource-group "$RESOURCE_GROUP" \
    --name "$CONTAINER_APP_NAME" \
    --environment "$MANAGED_ENV_NAME" \
    --hostname "$CUSTOM_HOST" \
    --certificate "$CERT_NAME" \
    -o none
fi

echo "Verifying ACA default ingress health..."
curl -fsSI "https://$CSS_FQDN/" >/dev/null

echo "Verifying CSS base URL health..."
curl -fsSI "$CSS_BASE_URL" >/dev/null

echo "Solid redeploy completed successfully."
echo "Container App: $CONTAINER_APP_NAME"
echo "Managed Env: $MANAGED_ENV_NAME"
echo "CSS FQDN: https://$CSS_FQDN/"
echo "CSS Base URL: $CSS_BASE_URL"