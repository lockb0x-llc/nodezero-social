#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOLID_AUTH_UI_REPO="${SOLID_AUTH_UI_REPO:-$REPO_ROOT/../solid-nodezero-auth-ui}"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
ACR_NAME="${AZURE_CONTAINER_REGISTRY:-}"
IMAGE_REPOSITORY="${AZURE_SOLID_THEME_IMAGE_REPOSITORY:-solid/community-server-nodezero-auth-ui}"
IMAGE_TAG="${AZURE_SOLID_THEME_IMAGE_TAG:-staging-$(date +%Y%m%d%H%M%S)}"

trim_cli_output() {
  printf '%s' "$1" | tr -d '\r\n'
}

az_path() {
  local input_path="$1"
  if [[ "$input_path" =~ ^/mnt/([a-zA-Z])/(.*)$ ]]; then
    local drive="${BASH_REMATCH[1]}"
    local remainder="${BASH_REMATCH[2]}"
    remainder="${remainder//\//\\}"
    printf '%s:\\%s' "${drive^^}" "$remainder"
    return
  fi
  if command -v wslpath >/dev/null 2>&1; then
    if [[ "$input_path" == /* ]]; then
      wslpath -w "$input_path"
      return
    fi
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

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd az
require_cmd npm
require_cmd mktemp

if [[ -z "$RESOURCE_GROUP" ]]; then
  echo "AZURE_RESOURCE_GROUP is required."
  exit 1
fi

if [[ ! -d "$SOLID_AUTH_UI_REPO" ]]; then
  echo "solid-nodezero-auth-ui repo not found at: $SOLID_AUTH_UI_REPO"
  exit 1
fi

if [[ -z "$ACR_NAME" ]]; then
  ACR_NAME_RAW="$(az acr list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv)"
  ACR_NAME="$(trim_cli_output "$ACR_NAME_RAW")"
fi

if [[ -z "$ACR_NAME" ]]; then
  echo "No ACR found. Set AZURE_CONTAINER_REGISTRY or create one in $RESOURCE_GROUP."
  exit 1
fi

if ! az acr show --resource-group "$RESOURCE_GROUP" --name "$ACR_NAME" >/dev/null 2>&1; then
  echo "ACR '$ACR_NAME' was not found in resource group '$RESOURCE_GROUP'."
  exit 1
fi

BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

echo "Building @nodezero/solid-nodezero-auth-ui package..."
pushd "$SOLID_AUTH_UI_REPO" >/dev/null
npm ci
npm run build
PKG_FILE="$(npm pack | tail -n 1)"
cp "$PKG_FILE" "$BUILD_DIR/solid-nodezero-auth-ui.tgz"
popd >/dev/null

echo "Building @nodezero/css-stellar-auth plugin..."
pushd "$REPO_ROOT/packages/css-stellar-auth" >/dev/null
# Install devDependencies (including @solid/community-server peer) then build.
npm install --include=dev
npm run build
STELLAR_PKG_FILE="$(npm pack | tail -n 1)"
cp "$STELLAR_PKG_FILE" "$BUILD_DIR/css-stellar-auth.tgz"
popd >/dev/null

cp "$REPO_ROOT/infrastructure/azure/solid-theme/Dockerfile" "$BUILD_DIR/Dockerfile"
mkdir -p "$BUILD_DIR/templates" "$BUILD_DIR/styles" "$BUILD_DIR/css-config"
cp "$REPO_ROOT/infrastructure/azure/solid-theme/templates/main.html.ejs" "$BUILD_DIR/templates/main.html.ejs"
cp "$REPO_ROOT/infrastructure/azure/solid-theme/styles/nodezero-theme.css" "$BUILD_DIR/styles/nodezero-theme.css"
cp "$REPO_ROOT/infrastructure/azure/solid-theme/css-config/nodezero.json" "$BUILD_DIR/css-config/nodezero.json"

AZ_BUILD_DIR="$(az_path "$BUILD_DIR")"
AZ_DOCKERFILE="$(az_path "$BUILD_DIR/Dockerfile")"

echo "Building custom Solid image in ACR '$ACR_NAME'..."
az acr build \
  --registry "$ACR_NAME" \
  --image "$IMAGE_REPOSITORY:$IMAGE_TAG" \
  --file "$AZ_DOCKERFILE" \
  "$AZ_BUILD_DIR"

LOGIN_SERVER_RAW="$(az acr show --resource-group "$RESOURCE_GROUP" --name "$ACR_NAME" --query "loginServer" -o tsv)"
LOGIN_SERVER="$(trim_cli_output "$LOGIN_SERVER_RAW")"
IMAGE_REF="$LOGIN_SERVER/$IMAGE_REPOSITORY:$IMAGE_TAG"

echo "Built image: $IMAGE_REF"
