@description('Deployment location for all resources.')
param location string = resourceGroup().location

@description('Short environment identifier (e.g. testnet, staging, prod).')
@minLength(2)
@allowed([
  'testnet'
  'staging-testnet'
  'production-mainnet'
])
param environmentName string = 'testnet'

@description('Global application name prefix.')
@minLength(3)
param appName string = 'nodezero-social'

@description('Static Web App deployment region.')
param staticWebAppLocation string = 'eastus2'

@description('Contract ID for the NodeZeroIdentity contract.')
@secure()
param identityContractId string

@description('Contract ID for the Lockb0x contract.')
@secure()
param lockboxContractId string

@description('Published URL for ZK artifact bundle.')
@secure()
param zkArtifactsUrl string

@description('Published URL for ZK manifest JSON.')
@secure()
param zkManifestUrl string

var resourceToken = toLower(uniqueString(resourceGroup().id, appName, environmentName))
var storageAccountName = 'st${take(resourceToken, 22)}'
var keyVaultName = take('${replace(appName, '-', '')}${replace(environmentName, '-', '')}kv${resourceToken}', 24)
var staticWebAppName = '${appName}-${environmentName}-web'
var appInsightsName = '${appName}-${environmentName}-appi'
var logAnalyticsName = '${appName}-${environmentName}-law'
var commonTags = {
  application: appName
  environment: environmentName
  runtimeBoundary: environmentName == 'production-mainnet' ? 'production' : 'non-production'
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  tags: commonTags
  properties: {
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: commonTags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: commonTags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-02-01' = {
  name: keyVaultName
  location: location
  tags: commonTags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enabledForDeployment: false
    enabledForTemplateDeployment: true
    enabledForDiskEncryption: false
    enableRbacAuthorization: true
    softDeleteRetentionInDays: 90
  }
}

resource identityContractSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  name: 'stellar-identity-contract-id'
  parent: keyVault
  properties: {
    value: identityContractId
  }
}

resource lockboxContractSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  name: 'stellar-lockbox-contract-id'
  parent: keyVault
  properties: {
    value: lockboxContractId
  }
}

resource zkArtifactsSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  name: 'zk-artifacts-url'
  parent: keyVault
  properties: {
    value: zkArtifactsUrl
  }
}

resource zkManifestSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  name: 'zk-manifest-url'
  parent: keyVault
  properties: {
    value: zkManifestUrl
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
  tags: commonTags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    provider: 'Other'
  }
}

output staticWebAppName string = staticWebApp.name
output staticWebAppDefaultHostname string = staticWebApp.properties.defaultHostname
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output keyVaultUri string = keyVault.properties.vaultUri
