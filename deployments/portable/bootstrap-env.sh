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
NZ_ZK_ARTIFACTS_URL=https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/
NZ_ZK_MANIFEST_URL=https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/zk-testnet-artifacts.json
JSS_STELLAR_SOURCE_ACCOUNT=nodezero-testnet-lockbox-deployer
JSS_TREASURY_SOURCE_ACCOUNT=nodezero-testnet-treasury
JSS_DEPLOYER_SOURCE_ACCOUNT=nodezero-testnet-lockbox-deployer
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