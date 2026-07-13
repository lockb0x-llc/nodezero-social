// ─────────────────────────────────────────────────────────────────────────────
// NodeZero self-hosted Solid server (Community Solid Server) — hackathon MVP
//
// Single-replica CSS on Azure Container Apps with durable Pod/account storage
// on an Azure Files share mounted at /data. Auto-HTTPS via the Container Apps
// ingress domain (required for Solid-OIDC / DPoP).
//
// Scope: testnet/staging-testnet only. Minimal by design (no Front Door/WAF,
// no production stack). SMTP-backed auth/security email is supported (forgot
// password and related notifications) when emailProviderMode=smtp. Account
// creation is open and email verification is disabled via the default CSS file
// config — fine for a private demo, NOT for production. The base URL is derived from the ACA environment
// default domain so OIDC issuer + WebID URLs are correct on first deploy.
// ─────────────────────────────────────────────────────────────────────────────

@description('Deployment location for all resources.')
param location string = resourceGroup().location

@description('Short environment identifier. Production intentionally unsupported by this MVP module.')
@allowed([
  'testnet'
  'staging-testnet'
])
param environmentName string = 'staging-testnet'

@description('Global application name prefix.')
@minLength(3)
param appName string = 'nodezero-social'

@description('Pinned Community Solid Server container image.')
param cssImage string = 'docker.io/solidproject/community-server:7.1.9'

@description('Optional container registry server for cssImage when pulling from a private registry.')
param cssImageRegistryServer string = ''

@description('Optional container registry username for cssImage private pulls.')
param cssImageRegistryUsername string = ''

@description('Optional container registry password/token for cssImage private pulls.')
@secure()
param cssImageRegistryPassword string = ''

@description('CSS config argument passed to `-c` (for example, @css:config/file.json or a custom config path).')
param cssConfigArg string = '@css:config/file.json'

@description('CSS data directory argument passed to `-f`. Must be an absolute Linux path in the container.')
param cssDataPath string = '/data'

@description('Optional extra CLI args appended to the CSS container command.')
param cssExtraArgs array = []

@description('Azure Files share size in GiB for Pod + account data.')
@minValue(1)
@maxValue(1024)
param fileShareQuotaGb int = 100

@description('vCPU cores for the CSS container (must pair with containerMemory per ACA rules).')
param containerCpu string = '1.0'

@description('Memory for the CSS container (e.g. 2Gi pairs with 1.0 vCPU).')
param containerMemory string = '2Gi'

@description('Optional custom domain host for CSS identity URLs (for example, solid.nodezero.social). Leave empty to use the default ACA ingress domain.')
param cssCustomDomain string = ''

@description('Log Analytics retention period in days.')
@minValue(30)
@maxValue(90)
param logAnalyticsRetentionDays int = 30

@description('Daily ingestion cap (GB) for the Log Analytics workspace.')
@minValue(1)
@maxValue(10)
param logAnalyticsDailyQuotaGb int = 1

@description('Email provider mode for CSS identity notifications. Use smtp to enable forgot-password email delivery, or none to disable email sending.')
@allowed([
  'none'
  'smtp'
])
param emailProviderMode string = 'none'

@description('From address for security/auth emails sent by CSS.')
param emailFromAddress string = ''

@description('From display name for security/auth emails sent by CSS.')
param emailFromName string = 'Node Zero Security'

@description('SMTP host used when emailProviderMode=smtp.')
param smtpHost string = 'smtp.azurecomm.net'

@description('SMTP port used when emailProviderMode=smtp.')
@minValue(1)
@maxValue(65535)
param smtpPort int = 587

@description('Whether STARTTLS should be used for SMTP connections.')
param smtpStartTls bool = true

@description('SMTP username used when emailProviderMode=smtp.')
@secure()
param smtpUsername string = ''

@description('SMTP password/secret used when emailProviderMode=smtp.')
@secure()
param smtpPassword string = ''

@description('HMAC shared secret for the Stellar auth plugin (NZ_STELLAR_AUTH_SHARED_SECRET). Must be >=32 chars. Required when the Stellar auth CSS plugin is enabled.')
@secure()
param stellarAuthSharedSecret string = ''

@description('Comma-separated trusted provisioner origins for the Stellar auth CSS plugin (NZ_STELLAR_AUTH_PROVISIONER_ORIGINS).')
param stellarAuthProvisionerOrigins string = ''

var resourceToken = toLower(uniqueString(resourceGroup().id, appName, environmentName, 'solid'))
var logAnalyticsName = '${appName}-${environmentName}-solid-law'
var storageAccountName = 'stsolid${take(resourceToken, 16)}'
var managedEnvName = '${appName}-${environmentName}-solid-env'
// ACA Container App names are capped at 32 chars; keep this short.
var containerAppName = 'nz-${environmentName}-solid'
var shareName = 'css-data'
var envStorageName = 'cssdata'
var volumeName = 'css-data'

var commonTags = {
  application: appName
  environment: environmentName
  component: 'solid-server'
  runtimeBoundary: 'non-production'
  costGuardrail: 'enabled'
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

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  name: 'default'
  parent: storage
}

resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  name: shareName
  parent: fileService
  properties: {
    shareQuota: fileShareQuotaGb
    enabledProtocols: 'SMB'
  }
}

resource managedEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: managedEnvName
  location: location
  tags: commonTags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource envStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  name: envStorageName
  parent: managedEnv
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: shareName
      accessMode: 'ReadWrite'
    }
  }
}

// OIDC issuer + WebID base URL must be the public HTTPS origin of the ingress.
var baseHostRaw = empty(cssCustomDomain) ? '${containerAppName}.${managedEnv.properties.defaultDomain}' : cssCustomDomain
var baseHost = endsWith(baseHostRaw, '/') ? substring(baseHostRaw, 0, max(length(baseHostRaw) - 1, 0)) : baseHostRaw
var baseUrl = 'https://${baseHost}/'
var cssContainerArgs = concat([
  '-b'
  baseUrl
  '-c'
  cssConfigArg
  '-f'
  cssDataPath
  '-p'
  '3000'
  '--loggingLevel'
  'info'
], cssExtraArgs)
var smtpSecrets = emailProviderMode == 'smtp'
  ? [
      {
        name: 'solid-smtp-username'
        value: smtpUsername
      }
      {
        name: 'solid-smtp-password'
        value: smtpPassword
      }
    ]
  : []
var cssImageRegistryEnabled = !empty(cssImageRegistryServer) && !empty(cssImageRegistryUsername) && !empty(cssImageRegistryPassword)
var cssImageRegistrySecrets = cssImageRegistryEnabled
  ? [
      {
        name: 'css-image-registry-password'
        value: cssImageRegistryPassword
      }
    ]
  : []
var cssImageRegistries = cssImageRegistryEnabled
  ? [
      {
        server: cssImageRegistryServer
        username: cssImageRegistryUsername
        passwordSecretRef: 'css-image-registry-password'
      }
    ]
  : []
var emailBaseEnv = [
  {
    name: 'NZ_SOLID_EMAIL_PROVIDER_MODE'
    value: emailProviderMode
  }
  {
    name: 'NZ_SOLID_EMAIL_FROM_ADDRESS'
    value: emailFromAddress
  }
  {
    name: 'NZ_SOLID_EMAIL_FROM_NAME'
    value: emailFromName
  }
  {
    name: 'NZ_SOLID_SMTP_HOST'
    value: smtpHost
  }
  {
    name: 'NZ_SOLID_SMTP_PORT'
    value: string(smtpPort)
  }
  {
    name: 'NZ_SOLID_SMTP_STARTTLS'
    value: smtpStartTls ? 'true' : 'false'
  }
]
var smtpSecretEnv = emailProviderMode == 'smtp'
  ? [
      {
        name: 'NZ_SOLID_SMTP_USERNAME'
        secretRef: 'solid-smtp-username'
      }
      {
        name: 'NZ_SOLID_SMTP_PASSWORD'
        secretRef: 'solid-smtp-password'
      }
    ]
  : []

var stellarAuthSecrets = !empty(stellarAuthSharedSecret)
  ? [
      {
        name: 'nz-stellar-auth-shared-secret'
        value: stellarAuthSharedSecret
      }
    ]
  : []

var stellarAuthSecretEnv = !empty(stellarAuthSharedSecret)
  ? [
      {
        name: 'NZ_STELLAR_AUTH_SHARED_SECRET'
        secretRef: 'nz-stellar-auth-shared-secret'
      }
    ]
  : []

var stellarAuthEnv = !empty(stellarAuthProvisionerOrigins)
  ? [
      {
        name: 'NZ_STELLAR_AUTH_PROVISIONER_ORIGINS'
        value: stellarAuthProvisionerOrigins
      }
    ]
  : []

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  tags: commonTags
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      secrets: concat(smtpSecrets, cssImageRegistrySecrets, stellarAuthSecrets)
      registries: cssImageRegistries
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
    }
    template: {
      containers: [
        {
          name: 'css'
          image: cssImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          args: cssContainerArgs
          env: concat(emailBaseEnv, smtpSecretEnv, stellarAuthSecretEnv, stellarAuthEnv)
          volumeMounts: [
            {
              volumeName: volumeName
              mountPath: '/data'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
      volumes: [
        {
          name: volumeName
          storageType: 'AzureFile'
          storageName: envStorageName
        }
      ]
    }
  }
  dependsOn: [
    envStorage
  ]
}

output cssBaseUrl string = baseUrl
output cssFqdn string = containerApp.properties.configuration.ingress.fqdn
output containerAppName string = containerApp.name
output storageAccountName string = storage.name
output logAnalyticsName string = logAnalytics.name
