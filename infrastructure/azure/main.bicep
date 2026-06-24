@description('Deployment location for all resources.')
param location string = resourceGroup().location

@description('Short environment identifier (e.g. testnet, staging, prod).')
param environmentName string = 'testnet'

@description('Global application name prefix.')
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
var storageAccountName = take(replace('${appName}${environmentName}${resourceToken}', '-', ''), 24)
var keyVaultName = take(replace('${appName}-${environmentName}-kv-${resourceToken}', '--', '-'), 24)
var staticWebAppName = '${appName}-${environmentName}-web'
var appInsightsName = '${appName}-${environmentName}-appi'
var logAnalyticsName = '${appName}-${environmentName}-law'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
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
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
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
  name: '${keyVault.name}/stellar-identity-contract-id'
  properties: {
    value: identityContractId
  }
}

resource lockboxContractSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  name: '${keyVault.name}/stellar-lockbox-contract-id'
  properties: {
    value: lockboxContractId
  }
}

resource zkArtifactsSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  name: '${keyVault.name}/zk-artifacts-url'
  properties: {
    value: zkArtifactsUrl
  }
}

resource zkManifestSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  name: '${keyVault.name}/zk-manifest-url'
  properties: {
    value: zkManifestUrl
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
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
