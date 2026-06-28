# Staging Deploy Prep: Solid OIDC Redirect Auth

This runbook prepares and verifies a staging web artifact that uses real Solid OIDC redirect auth while keeping Stellar TestNet contracts and relay wiring intact.

## 1. Preflight

1. Confirm Azure CLI is authenticated:
   - `az account show`
2. Confirm app-level env profile is staging:
   - `NZ_ENV_PROFILE=staging-testnet`
3. Confirm TestNet passphrase is used:
   - `NZ_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"`

## 2. Required build environment variables

Set these before exporting the web build:

- `EXPO_NO_DOTENV=1`
- `NZ_ENV_PROFILE=staging-testnet`
- `NZ_SOLID_OIDC_ISSUER_URL=<staging Solid OIDC issuer url>`
- `NZ_SOLID_SIGNUP_URL=<staging Solid signup url>`
- `NZ_SOLID_ACCOUNT_PORTAL_URL=<staging Solid account portal url>`
- `NZ_RELAY_URL=wss://nodezero-social-staging-testnet-relay.azurewebsites.net`
- `NZ_STELLAR_RPC_URL=https://soroban-testnet.stellar.org`
- `NZ_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015`
- `NZ_IDENTITY_CONTRACT_ID=<staging identity contract id>`
- `NZ_LOCKBOX_CONTRACT_ID=<staging lockbox contract id>`
- `NZ_ZK_ARTIFACTS_URL=<published staging zk artifacts base url>`
- `NZ_ZK_MANIFEST_URL=<published staging zk manifest url>`

## 3. Build the staging artifact

From repo root:

```powershell
$env:EXPO_NO_DOTENV='1'
$env:NZ_ENV_PROFILE='staging-testnet'
$env:NZ_SOLID_OIDC_ISSUER_URL='https://solidcommunity.net/'
$env:NZ_SOLID_SIGNUP_URL='https://solidcommunity.net/register'
$env:NZ_SOLID_ACCOUNT_PORTAL_URL='https://solidcommunity.net/'
$env:NZ_RELAY_URL='wss://nodezero-social-staging-testnet-relay.azurewebsites.net'
$env:NZ_STELLAR_RPC_URL='https://soroban-testnet.stellar.org'
$env:NZ_STELLAR_NETWORK_PASSPHRASE='Test SDF Network ; September 2015'
$env:NZ_IDENTITY_CONTRACT_ID='CCHFYOKLGVTXEYYHWEFPI22FR26VRGG2CBBUTP6XPW3ZSIWIKEVQQ44K'
$env:NZ_LOCKBOX_CONTRACT_ID='CB36LY5WZLJNMY4DHRXQER6LU3L4E5MGFYT2XSJG7ZJZV5SIIOKODT2H'
$env:NZ_ZK_ARTIFACTS_URL='https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/'
$env:NZ_ZK_MANIFEST_URL='https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/zk-testnet-artifacts.json'

corepack pnpm --filter @nodezero/mobile-app exec expo export --platform web --output-dir dist --clear
```

## 4. Build artifact verification

Verify the compiled bundle embeds expected staging/OIDC values:

```powershell
$landing = Get-Content packages/mobile-app/dist/index.html -Raw
$bundlePath = [regex]::Match($landing,'src="([^"]*/_expo/static/js/web/[^"]+\.js)"').Groups[1].Value
$bundleFile = Join-Path 'packages/mobile-app/dist' ($bundlePath.TrimStart('/').Replace('/','\'))

Select-String -Path $bundleFile -Pattern '"envProfile":"staging-testnet"|"solidOidcIssuerUrl"|"solidSignupUrl"|nodezero-social-staging-testnet-relay.azurewebsites.net|Test SDF Network ; September 2015' -AllMatches

# Ensure removed legacy bootstrap/auth-mode keys are absent
Select-String -Path $bundleFile -Pattern '"bootstrapWebId"|"solidAuth"|"authMode"' -AllMatches
```

Expected matches:

- `"envProfile":"staging-testnet"`
- `"solidOidcIssuerUrl":"<configured issuer>"`
- `"solidSignupUrl":"<configured signup url>"`
- `nodezero-social-staging-testnet-relay.azurewebsites.net`
- `Test SDF Network ; September 2015`

Expected absence:

- No legacy bootstrap auth mode key.
- No legacy bootstrap WebID key.

## 5. Staging publish (when approved)

```powershell
Copy-Item packages/mobile-app/staticwebapp.config.json packages/mobile-app/dist/staticwebapp.config.json -Force
$token = az staticwebapp secrets list --name nodezero-social-staging-testnet-web --resource-group rg-nodezero-social-staging-testnet --query properties.apiKey -o tsv
npx -y @azure/static-web-apps-cli@2.0.7 deploy packages/mobile-app/dist --deployment-token $token --env production
```

## 6. Post-deploy verification

1. Smoke gate:
   - `STAGING_BASE_URL=https://staging.nodezero.social bash scripts/qa/staging-smoke.sh`
2. Runtime checks on UI:
   - Feed header shows auth-mode chip.
   - Local header shows auth-mode chip.
   - Settings shows auth-mode row and tooltip.
3. Relay health:
   - `https://nodezero-social-staging-testnet-relay.azurewebsites.net/health` returns 200 JSON.

## 7. Manual OIDC mode acceptance checklist

- Landing page reflects real Pod signup flow (no JSS wording).
- `Create Your Node` opens the configured signup URL.
- Sign in uses the configured OIDC issuer redirect.
- Authenticated routes show persistent auth-mode chip `OIDC Redirect` in Feed and Local.
- Wallet attestation section still references TestNet contract values in Settings.