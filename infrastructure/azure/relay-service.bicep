// ─────────────────────────────────────────────────────────────────────────────
// NodeZero WebSocket Signaling Relay Service (P2P Mesh Signaling)
//
// App Service Plan (Linux B1) and Web App running @nodezero/relay-service:
//   - WebSockets enabled for full-duplex P2P peer signaling.
//   - Health check endpoint at /healthz.
//   - Bound to the first-party provisioner for transport identity verification.
// ─────────────────────────────────────────────────────────────────────────────

@description('Deployment location for all resources.')
param location string = resourceGroup().location

@description('Short environment identifier.')
@allowed([
  'testnet'
  'staging-testnet'
  'production-mainnet'
])
param environmentName string = 'staging-testnet'

@description('Global application name prefix.')
@minLength(3)
param appName string = 'nodezero-social'

@description('Name of the dedicated App Service Plan for the relay service.')
param appServicePlanName string = 'asp-nodezero-staging-relay'

@description('App Service Plan SKU name.')
param appServicePlanSkuName string = 'B1'

@description('App Service Plan SKU tier.')
param appServicePlanSkuTier string = 'Basic'

@description('Base URL of the NodeZero provisioner API for identity verification.')
param provisionerBaseUrl string = 'https://api.nodezero.social'

@description('Listening port for the relay WebSocket server.')
param relayPort int = 8080

@description('Startup command line for the relay Node.js process.')
param appCommandLine string = 'node dist/index.js'

@description('Linux runtime stack identifier.')
param linuxFxVersion string = 'NODE|22-lts'

var siteName = '${appName}-${environmentName}-relay'
var commonTags = {
  application: appName
  environment: environmentName
  component: 'relay-service'
  runtimeBoundary: environmentName == 'production-mainnet' ? 'production' : 'non-production'
  costGuardrail: 'enabled'
}

resource appServicePlan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: appServicePlanName
  location: location
  tags: commonTags
  kind: 'linux'
  sku: {
    name: appServicePlanSkuName
    tier: appServicePlanSkuTier
    size: appServicePlanSkuName
    family: 'B'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource relayWebApp 'Microsoft.Web/sites@2022-09-01' = {
  name: siteName
  location: location
  tags: commonTags
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      alwaysOn: true
      appCommandLine: appCommandLine
      healthCheckPath: '/healthz'
      webSocketsEnabled: true
      appSettings: [
        {
          name: 'RELAY_PROVISIONER_URL'
          value: provisionerBaseUrl
        }
        {
          name: 'RELAY_PORT'
          value: string(relayPort)
        }
        {
          name: 'WEBSITES_PORT'
          value: string(relayPort)
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'ENABLE_ORYX_BUILD'
          value: 'false'
        }
      ]
    }
  }
}

output relayAppName string = relayWebApp.name
output relayDefaultHostname string = relayWebApp.properties.defaultHostName
output relayEndpointUrl string = 'https://${relayWebApp.properties.defaultHostName}'
output relayWebSocketUrl string = 'wss://${relayWebApp.properties.defaultHostName}'
