#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
PARAM_FILE="${AZURE_BICEP_PARAMETERS_FILE:-$REPO_ROOT/infrastructure/azure/main.parameters.example.json}"
TEMPLATE_FILE="$REPO_ROOT/infrastructure/azure/main.bicep"

if [[ -z "$RESOURCE_GROUP" ]]; then
  echo "AZURE_RESOURCE_GROUP is required."
  exit 1
fi

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI (az) is required."
  exit 1
fi

az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$TEMPLATE_FILE" \
  --parameters "@$PARAM_FILE"
