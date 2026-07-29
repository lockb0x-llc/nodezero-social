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

@description('Log Analytics retention period in days for staging observability data.')
@minValue(30)
@maxValue(90)
param logAnalyticsRetentionDays int = 30

@description('Daily ingestion cap (GB) for Log Analytics workspace cost control.')
@minValue(1)
@maxValue(10)
param logAnalyticsDailyQuotaGb int = 1

@description('Optional alert email for staging platform incidents (leave empty to disable action group wiring).')
param alertEmailAddress string = ''

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

@description('DNS zone name for the staging custom domain.')
param dnsZoneName string = 'nodezero.social'

@description('DNS host label for the staging Static Web App custom domain.')
param stagingHostLabel string = 'staging'

@description('DNS host label for the first-party provisioner API custom domain.')
param apiHostLabel string = 'api'

@description('Public Azure hostname of the staging provisioner App Service.')
param provisionerPublicHostName string = '${appName}-${environmentName}-provisioner.azurewebsites.net'

var resourceToken = toLower(uniqueString(resourceGroup().id, appName, environmentName))
var storageAccountName = 'st${take(resourceToken, 22)}'
var keyVaultName = take('${replace(appName, '-', '')}${replace(environmentName, '-', '')}kv${resourceToken}', 24)
var staticWebAppName = '${appName}-${environmentName}-web'
var appInsightsName = '${appName}-${environmentName}-appi'
var logAnalyticsName = '${appName}-${environmentName}-law'
var monitorActionGroupName = '${appName}-${environmentName}-ag'
var commonTags = {
  application: appName
  environment: environmentName
  runtimeBoundary: environmentName == 'production-mainnet' ? 'production' : 'non-production'
  costGuardrail: 'enabled'
  monitoringBaseline: 'enabled'
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  tags: commonTags
  properties: {
    retentionInDays: logAnalyticsRetentionDays
    sku: {
      name: 'PerGB2018'
    }
    workspaceCapping: {
      dailyQuotaGb: logAnalyticsDailyQuotaGb
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
    // Anonymous blob read is required: the web client downloads the public
    // ZK proving artifacts (pod_ownership wasm/zkey + manifest) directly from
    // the zk-artifacts container during onboarding. Artifacts are non-secret
    // and integrity-pinned via sha256 in the published manifest.
    allowBlobPublicAccess: true
    supportsHttpsTrafficOnly: true
  }
}

resource storageBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

// Public ZK proving artifacts consumed by the browser (wasm/zkey/manifest).
// publicAccess 'Blob' allows anonymous reads of individual blobs but not
// container listing.
resource zkArtifactsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: storageBlobService
  name: 'zk-artifacts'
  properties: {
    publicAccess: 'Blob'
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

resource monitorActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (!empty(alertEmailAddress)) {
  name: monitorActionGroupName
  location: 'global'
  tags: commonTags
  properties: {
    enabled: true
    groupShortName: 'nzstageag'
    emailReceivers: [
      {
        name: 'staging-oncall'
        emailAddress: alertEmailAddress
        useCommonAlertSchema: true
      }
    ]
  }
}

resource stagingErrorAlert 'Microsoft.Insights/activityLogAlerts@2020-10-01' = if (!empty(alertEmailAddress)) {
  name: '${appName}-${environmentName}-rg-admin-error'
  location: 'global'
  tags: commonTags
  properties: {
    enabled: true
    scopes: [
      subscription().id
    ]
    condition: {
      allOf: [
        {
          field: 'category'
          equals: 'Administrative'
        }
        {
          field: 'level'
          equals: 'Error'
        }
        {
          field: 'resourceGroup'
          equals: resourceGroup().name
        }
      ]
    }
    actions: {
      actionGroups: [
        {
          actionGroupId: monitorActionGroup.id
        }
      ]
    }
  }
}

resource dnsZone 'Microsoft.Network/dnsZones@2018-05-01' = {
  name: dnsZoneName
  location: 'global'
  tags: commonTags
}

resource stagingCname 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = {
  parent: dnsZone
  name: stagingHostLabel
  properties: {
    TTL: 300
    CNAMERecord: {
      cname: staticWebApp.properties.defaultHostname
    }
  }
}

// Apex alias A record — points nodezero.social to the SWA resource (same-subscription alias)
resource apexAliasRecord 'Microsoft.Network/dnsZones/A@2018-05-01' = {
  parent: dnsZone
  name: '@'
  properties: {
    TTL: 300
    targetResource: {
      id: staticWebApp.id
    }
  }
}

// www CNAME — points www.nodezero.social to the SWA default hostname
resource wwwCnameRecord 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = {
  parent: dnsZone
  name: 'www'
  properties: {
    TTL: 300
    CNAMERecord: {
      cname: staticWebApp.properties.defaultHostname
    }
  }
}

// www custom domain — validated via CNAME delegation
resource wwwCustomDomain 'Microsoft.Web/staticSites/customDomains@2022-09-01' = {
  parent: staticWebApp
  name: 'www.${dnsZoneName}'
  properties: {
    validationMethod: 'cname-delegation'
  }
  dependsOn: [wwwCnameRecord]
}

// api.nodezero.social is the first-party provisioner host. The App Service
// hostname/certificate binding is applied by the deployment workflow after
// this CNAME is live and Azure can validate ownership.
resource provisionerApiCname 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = {
  parent: dnsZone
  name: apiHostLabel
  properties: {
    TTL: 300
    CNAMERecord: {
      cname: provisionerPublicHostName
    }
  }
}

// NOTE: nodezero.social apex custom domain is NOT managed here.
// The apex domain is registered via manual ARM operation and monitored separately.
// The apexAliasRecord above provides the DNS A alias required for validation.

output staticWebAppName string = staticWebApp.name
output staticWebAppDefaultHostname string = staticWebApp.properties.defaultHostname
output stagingCustomHostname string = '${stagingHostLabel}.${dnsZoneName}'
output provisionerApiCustomHostname string = '${apiHostLabel}.${dnsZoneName}'
output azureDnsNameServers array = dnsZone.properties.nameServers
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output keyVaultUri string = keyVault.properties.vaultUri
