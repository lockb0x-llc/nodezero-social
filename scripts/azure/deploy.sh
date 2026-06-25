#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
PARAM_FILE="${AZURE_BICEP_PARAMETERS_FILE:-}"
TEMPLATE_FILE="$REPO_ROOT/infrastructure/azure/main.bicep"
TARGET_ENVIRONMENT="${AZURE_ENVIRONMENT_NAME:-}"

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

if [[ -z "$PARAM_FILE" ]]; then
  echo "AZURE_BICEP_PARAMETERS_FILE is required and must point to a secure environment-specific file."
  exit 1
fi

if [[ "$PARAM_FILE" == *"main.parameters.example.json" ]]; then
  echo "Refusing to deploy with the example parameters file. Provide a secure environment-specific parameters file."
  exit 1
fi

if [[ -z "$TARGET_ENVIRONMENT" ]]; then
  echo "AZURE_ENVIRONMENT_NAME is required. Allowed values: testnet, staging-testnet, production-mainnet"
  exit 1
fi

if [[ "$TARGET_ENVIRONMENT" != "testnet" && "$TARGET_ENVIRONMENT" != "staging-testnet" && "$TARGET_ENVIRONMENT" != "production-mainnet" ]]; then
  echo "Invalid AZURE_ENVIRONMENT_NAME '$TARGET_ENVIRONMENT'. Allowed values: testnet, staging-testnet, production-mainnet"
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

if ! az account show >/dev/null 2>&1; then
  echo "Azure CLI is not authenticated. Run 'az login' first."
  exit 1
fi

if ! az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "Resource group '$RESOURCE_GROUP' does not exist or is inaccessible."
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

if [[ "$TARGET_ENVIRONMENT" == "production-mainnet" ]]; then
  echo "Refusing production-mainnet deployment from this script. Use the dedicated production release workflow."
  exit 1
fi

echo "Running preflight what-if for environment '$TARGET_ENVIRONMENT'..."
az deployment group what-if \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$TEMPLATE_FILE" \
  --parameters "@$PARAM_FILE" \
  --result-format ResourceIdOnly

echo "Applying deployment for environment '$TARGET_ENVIRONMENT'..."
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$TEMPLATE_FILE" \
  --parameters "@$PARAM_FILE" \
  --query properties.provisioningState \
  -o tsv
