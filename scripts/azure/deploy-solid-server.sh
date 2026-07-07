#!/usr/bin/env bash
set -euo pipefail

# Deploy the NodeZero self-hosted Solid server (CSS) MVP stack.
# Testnet-only. Mirrors the guardrail pattern of scripts/azure/deploy.sh.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
PARAM_FILE="${AZURE_BICEP_PARAMETERS_FILE:-$REPO_ROOT/infrastructure/azure/solid-server.parameters.staging-testnet.json}"
TEMPLATE_FILE="$REPO_ROOT/infrastructure/azure/solid-server.bicep"
TARGET_ENVIRONMENT="${AZURE_ENVIRONMENT_NAME:-staging-testnet}"
CSS_CONFIG_ARG="${AZURE_CSS_CONFIG_ARG:-}"
CSS_DATA_PATH="${AZURE_CSS_DATA_PATH:-}"
CSS_EXTRA_ARGS_JSON="${AZURE_CSS_EXTRA_ARGS_JSON:-}"
CSS_IMAGE="${AZURE_SOLID_CSS_IMAGE:-}"
CSS_IMAGE_REGISTRY_SERVER="${AZURE_SOLID_CSS_IMAGE_REGISTRY_SERVER:-}"
CSS_IMAGE_REGISTRY_USERNAME="${AZURE_SOLID_CSS_IMAGE_REGISTRY_USERNAME:-}"
CSS_IMAGE_REGISTRY_PASSWORD="${AZURE_SOLID_CSS_IMAGE_REGISTRY_PASSWORD:-}"
CSS_CUSTOM_DOMAIN="${AZURE_SOLID_CSS_CUSTOM_DOMAIN:-}"
EMAIL_PROVIDER_MODE="${AZURE_SOLID_EMAIL_PROVIDER_MODE:-}"
EMAIL_FROM_ADDRESS="${AZURE_SOLID_EMAIL_FROM_ADDRESS:-}"
EMAIL_FROM_NAME="${AZURE_SOLID_EMAIL_FROM_NAME:-}"
SMTP_HOST="${AZURE_SOLID_SMTP_HOST:-}"
SMTP_PORT="${AZURE_SOLID_SMTP_PORT:-}"
SMTP_STARTTLS="${AZURE_SOLID_SMTP_STARTTLS:-}"
SMTP_USERNAME="${AZURE_SOLID_SMTP_USERNAME:-}"
SMTP_PASSWORD="${AZURE_SOLID_SMTP_PASSWORD:-}"

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

PARAM_OVERRIDES=()

if [[ -z "$RESOURCE_GROUP" ]]; then
  echo "AZURE_RESOURCE_GROUP is required."
  exit 1
fi

if [[ ! -f "$PARAM_FILE" ]]; then
  echo "Parameters file not found: $PARAM_FILE"
  exit 1
fi

if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Template file not found: $TEMPLATE_FILE"
  exit 1
fi

if [[ "$TARGET_ENVIRONMENT" != "testnet" && "$TARGET_ENVIRONMENT" != "staging-testnet" ]]; then
  echo "Invalid AZURE_ENVIRONMENT_NAME '$TARGET_ENVIRONMENT'. This MVP module is testnet-only."
  exit 1
fi

if [[ "$TARGET_ENVIRONMENT" == "production-mainnet" ]]; then
  echo "Refusing production-mainnet deployment from the MVP script."
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

PARAM_EMAIL_MODE="$(node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log((p?.parameters?.emailProviderMode?.value ?? 'none').toLowerCase());" "$PARAM_FILE")"
EFFECTIVE_EMAIL_MODE="${EMAIL_PROVIDER_MODE:-$PARAM_EMAIL_MODE}"
PARAM_CUSTOM_DOMAIN="$(node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const v = p?.parameters?.cssCustomDomain?.value ?? ''; console.log(String(v).trim());" "$PARAM_FILE")"
EFFECTIVE_CUSTOM_DOMAIN="${CSS_CUSTOM_DOMAIN:-$PARAM_CUSTOM_DOMAIN}"
PARAM_CSS_IMAGE="$(node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const v = p?.parameters?.cssImage?.value ?? ''; console.log(String(v).trim());" "$PARAM_FILE")"
EFFECTIVE_CSS_IMAGE="${CSS_IMAGE:-$PARAM_CSS_IMAGE}"
EFFECTIVE_CUSTOM_DOMAIN_LOWER="${EFFECTIVE_CUSTOM_DOMAIN,,}"

if [[ "$EFFECTIVE_EMAIL_MODE" != "none" && "$EFFECTIVE_EMAIL_MODE" != "smtp" ]]; then
  echo "Invalid effective emailProviderMode '$EFFECTIVE_EMAIL_MODE'. Allowed values: none, smtp."
  exit 1
fi

if [[ "$EFFECTIVE_EMAIL_MODE" == "smtp" ]]; then
  if [[ -z "$EMAIL_FROM_ADDRESS" ]]; then
    echo "SMTP mode requires AZURE_SOLID_EMAIL_FROM_ADDRESS to be set (or provided in the parameters file)."
    exit 1
  fi
  if [[ -z "$SMTP_USERNAME" || -z "$SMTP_PASSWORD" ]]; then
    echo "SMTP mode requires AZURE_SOLID_SMTP_USERNAME and AZURE_SOLID_SMTP_PASSWORD to be set."
    exit 1
  fi
  if [[ -n "$SMTP_PORT" && ! "$SMTP_PORT" =~ ^[0-9]+$ ]]; then
    echo "AZURE_SOLID_SMTP_PORT must be numeric when provided."
    exit 1
  fi
  if [[ -n "$SMTP_STARTTLS" ]]; then
    case "${SMTP_STARTTLS,,}" in
      true|false) ;;
      *)
        echo "AZURE_SOLID_SMTP_STARTTLS must be true or false when provided."
        exit 1
        ;;
    esac
  fi
fi

# Hard gate: Node Zero Community Solid Server must always run the themed auth UI image.
if [[ "$EFFECTIVE_CUSTOM_DOMAIN_LOWER" == "solid.nodezero.social" ]]; then
  if [[ -z "$EFFECTIVE_CSS_IMAGE" ]]; then
    echo "Themed image hard gate failed: no effective cssImage was resolved for solid.nodezero.social."
    exit 1
  fi

  if [[ "$EFFECTIVE_CSS_IMAGE" != *"/solid/community-server-nodezero-auth-ui:"* ]]; then
    echo "Themed image hard gate failed for solid.nodezero.social."
    echo "Expected a NodeZero themed image in repository '/solid/community-server-nodezero-auth-ui', got: $EFFECTIVE_CSS_IMAGE"
    exit 1
  fi
fi

if [[ -n "$CSS_CONFIG_ARG" ]]; then
  PARAM_OVERRIDES+=("cssConfigArg=$CSS_CONFIG_ARG")
fi

if [[ -n "$CSS_IMAGE" ]]; then
  PARAM_OVERRIDES+=("cssImage=$CSS_IMAGE")
fi

if [[ -n "$CSS_CUSTOM_DOMAIN" ]]; then
  if [[ "$CSS_CUSTOM_DOMAIN" == *"://"* || "$CSS_CUSTOM_DOMAIN" == */* ]]; then
    echo "AZURE_SOLID_CSS_CUSTOM_DOMAIN must be a bare hostname (for example, solid.nodezero.social)."
    exit 1
  fi
  PARAM_OVERRIDES+=("cssCustomDomain=$CSS_CUSTOM_DOMAIN")
fi

if [[ -n "$CSS_IMAGE_REGISTRY_SERVER" ]]; then
  PARAM_OVERRIDES+=("cssImageRegistryServer=$CSS_IMAGE_REGISTRY_SERVER")
fi

if [[ -n "$CSS_IMAGE_REGISTRY_USERNAME" ]]; then
  PARAM_OVERRIDES+=("cssImageRegistryUsername=$CSS_IMAGE_REGISTRY_USERNAME")
fi

if [[ -n "$CSS_IMAGE_REGISTRY_PASSWORD" ]]; then
  PARAM_OVERRIDES+=("cssImageRegistryPassword=$CSS_IMAGE_REGISTRY_PASSWORD")
fi

if [[ -n "$CSS_DATA_PATH" ]]; then
  if [[ "$CSS_DATA_PATH" != /* ]]; then
    echo "AZURE_CSS_DATA_PATH must be an absolute Linux path (for example, /data)."
    exit 1
  fi
  PARAM_OVERRIDES+=("cssDataPath=$CSS_DATA_PATH")
fi

if [[ -n "$CSS_EXTRA_ARGS_JSON" ]]; then
  if ! node -e "const raw = process.argv[1]; const parsed = JSON.parse(raw); if (!Array.isArray(parsed)) process.exit(2);" "$CSS_EXTRA_ARGS_JSON" >/dev/null 2>&1; then
    echo "AZURE_CSS_EXTRA_ARGS_JSON must be a valid JSON array string."
    exit 1
  fi
  PARAM_OVERRIDES+=("cssExtraArgs=$CSS_EXTRA_ARGS_JSON")
fi

if [[ -n "$EMAIL_PROVIDER_MODE" ]]; then
  PARAM_OVERRIDES+=("emailProviderMode=$EMAIL_PROVIDER_MODE")
fi

if [[ -n "$EMAIL_FROM_ADDRESS" ]]; then
  PARAM_OVERRIDES+=("emailFromAddress=$EMAIL_FROM_ADDRESS")
fi

if [[ -n "$EMAIL_FROM_NAME" ]]; then
  PARAM_OVERRIDES+=("emailFromName=$EMAIL_FROM_NAME")
fi

if [[ -n "$SMTP_HOST" ]]; then
  PARAM_OVERRIDES+=("smtpHost=$SMTP_HOST")
fi

if [[ -n "$SMTP_PORT" ]]; then
  PARAM_OVERRIDES+=("smtpPort=$SMTP_PORT")
fi

if [[ -n "$SMTP_STARTTLS" ]]; then
  PARAM_OVERRIDES+=("smtpStartTls=${SMTP_STARTTLS,,}")
fi

if [[ -n "$SMTP_USERNAME" ]]; then
  PARAM_OVERRIDES+=("smtpUsername=$SMTP_USERNAME")
fi

if [[ -n "$SMTP_PASSWORD" ]]; then
  PARAM_OVERRIDES+=("smtpPassword=$SMTP_PASSWORD")
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

if [[ -n "$EFFECTIVE_CUSTOM_DOMAIN" ]]; then
  CONTAINER_APP_NAME="nz-${TARGET_ENVIRONMENT}-solid"
  echo "Ensuring custom domain binding for '$EFFECTIVE_CUSTOM_DOMAIN' on Container App '$CONTAINER_APP_NAME'..."

  MANAGED_ENV_ID="$(az containerapp show --resource-group "$RESOURCE_GROUP" --name "$CONTAINER_APP_NAME" --query "properties.managedEnvironmentId" -o tsv | tr -d '\r')"
  if [[ -z "$MANAGED_ENV_ID" ]]; then
    echo "Unable to resolve managed environment for container app '$CONTAINER_APP_NAME'."
    exit 1
  fi
  MANAGED_ENV_NAME="${MANAGED_ENV_ID##*/}"

  CERT_NAME="$(az containerapp env certificate list --resource-group "$RESOURCE_GROUP" --name "$MANAGED_ENV_NAME" --query "[?properties.subjectName=='$EFFECTIVE_CUSTOM_DOMAIN' && properties.provisioningState=='Succeeded'].name | [0]" -o tsv | tr -d '\r')"
  if [[ -z "$CERT_NAME" ]]; then
    CERT_NAME="$(printf 'solid-%s-cert' "$EFFECTIVE_CUSTOM_DOMAIN" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | cut -c1-60)"
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
