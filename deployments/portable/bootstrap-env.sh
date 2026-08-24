#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env}"
KEY_VAULT_NAME="${AZURE_KEY_VAULT_NAME:?AZURE_KEY_VAULT_NAME is required}"

command -v az >/dev/null 2>&1 || { echo "Azure CLI is required." >&2; exit 1; }
az login --identity --allow-no-subscriptions --only-show-errors >/dev/null

secret() {
  az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "$1" --query value -o tsv --only-show-errors
}

cat > "$ENV_FILE" <<EOF
PUBLIC_HOST=${PUBLIC_HOST:?PUBLIC_HOST is required}
API_HOST=${API_HOST:?API_HOST is required}
SOLID_HOST=${SOLID_HOST:?SOLID_HOST is required}
RELAY_HOST=${RELAY_HOST:?RELAY_HOST is required}
ACME_EMAIL=${ACME_EMAIL:?ACME_EMAIL is required}
NZ_ENV_PROFILE=staging-testnet
NZ_APP_ORIGIN=https://${PUBLIC_HOST}
NZ_JSS_PROVISIONER_URL=https://${API_HOST}
NZ_NODEZERO_ISSUER_URL=https://${SOLID_HOST}/
NZ_RELAY_URL=wss://${RELAY_HOST}
NZ_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NZ_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
NZ_IDENTITY_CONTRACT_ID=CCHFYOKLGVTXEYYHWEFPI22FR26VRGG2CBBUTP6XPW3ZSIWIKEVQQ44K
NZ_LOCKBOX_CONTRACT_ID=CB36LY5WZLJNMY4DHRXQER6LU3L4E5MGFYT2XSJG7ZJZV5SIIOKODT2H
NZ_LOCKBOX_FACTORY_CONTRACT_ID=CA5MASVC7CH646QUZM6HFC3JAYIG4TCRHJDSBDOBFP66IW7TXYYHFUVB
NZ_LOCKBOX_FACTORY_VERSION=3
JSS_LOCKBOX_FACTORY_VERSION=v3
NZ_ZK_ARTIFACTS_URL=https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/
NZ_ZK_MANIFEST_URL=https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/zk-testnet-artifacts.json
JSS_LOCKBOX_BRIDGE_V3_MANIFEST_URL=https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/lockb0x-bridge-v3/zk-testnet-lockbox-bridge-v3-artifacts.json
JSS_LOCKBOX_BRIDGE_V3_MANIFEST_SHA256=cd8dd099419334c3fda73d837032aea62588a6d4f3dac5167367fc13affe2b70
JSS_LOCKBOX_BRIDGE_V3_WASM_URL=https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/lockb0x_bridge_v3/pod_stellar_bridge_v3_js/pod_stellar_bridge_v3.wasm
JSS_LOCKBOX_BRIDGE_V3_WASM_SHA256=a878e467bf4e11f82a67aaf46e36786bc66b909baa21ae2c802ac1e66b4d3150
JSS_LOCKBOX_BRIDGE_V3_ZKEY_URL=https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/lockb0x_bridge_v3/pod_stellar_bridge_v3_final.zkey
JSS_LOCKBOX_BRIDGE_V3_ZKEY_SHA256=9cbc69f2d398fcee1309a815fef968866851e432f0f1fbaf39fb5992dbbf8784
JSS_LOCKBOX_BRIDGE_V3_VK_URL=https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/lockb0x_bridge_v3/pod_stellar_bridge_v3_vk.json
JSS_LOCKBOX_BRIDGE_V3_VK_SHA256=b6bbc440444299e6d449ca0f2f594341f50c7e71a79f0c98734655fdcae8a39b
JSS_STELLAR_SOURCE_ACCOUNT=nodezero-testnet-lockbox-deployer
JSS_TREASURY_SOURCE_ACCOUNT=nodezero-testnet-treasury
JSS_DEPLOYER_SOURCE_ACCOUNT=nodezero-testnet-lockbox-deployer
JSS_LOCKBOX_FACTORY_MODE=soroban
JSS_TREASURY_FUND_MEMBERS=1
JSS_TREASURY_SECRET=$(secret stellar-treasury-secret)
JSS_DEPLOYER_SECRET=$(secret stellar-deployer-secret)
JSS_CREDENTIALS_ENC_KEY=$(secret jss-credentials-enc-key)
JSS_SESSION_SIGNING_KEY=$(secret jss-session-signing-key)
JSS_RELATIONSHIP_DELIVERY_SIGNING_KEY=$(secret jss-relationship-delivery-signing-key)
NZ_STELLAR_AUTH_SHARED_SECRET=$(secret nz-stellar-auth-shared-secret)
CSS_IMAGE=solidproject/community-server:7.1.9
EOF

chmod 600 "$ENV_FILE"
echo "Wrote protected portable environment file: $ENV_FILE"