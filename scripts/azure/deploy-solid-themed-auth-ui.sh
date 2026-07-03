#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
PARAM_FILE="${AZURE_BICEP_PARAMETERS_FILE:-$REPO_ROOT/infrastructure/azure/solid-server.parameters.staging-testnet.json}"
TARGET_ENVIRONMENT="${AZURE_ENVIRONMENT_NAME:-staging-testnet}"

if [[ -z "$RESOURCE_GROUP" ]]; then
  echo "AZURE_RESOURCE_GROUP is required."
  exit 1
fi

BUILD_OUTPUT="$(AZURE_RESOURCE_GROUP="$RESOURCE_GROUP" "$REPO_ROOT/scripts/azure/build-solid-themed-image.sh")"
IMAGE_REF="$(printf '%s\n' "$BUILD_OUTPUT" | sed -n 's/^Built image: //p' | tail -n 1)"

if [[ -z "$IMAGE_REF" ]]; then
  echo "Failed to resolve image reference from build output."
  echo "$BUILD_OUTPUT"
  exit 1
fi

echo "$BUILD_OUTPUT"
echo "Deploying Solid server with image: $IMAGE_REF"

AZURE_RESOURCE_GROUP="$RESOURCE_GROUP" \
AZURE_BICEP_PARAMETERS_FILE="$PARAM_FILE" \
AZURE_ENVIRONMENT_NAME="$TARGET_ENVIRONMENT" \
AZURE_SOLID_CSS_IMAGE="$IMAGE_REF" \
bash "$REPO_ROOT/scripts/azure/redeploy-solid-server.sh"

echo "Themed Solid deployment complete: $IMAGE_REF"
