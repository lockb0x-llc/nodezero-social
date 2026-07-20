// ─────────────────────────────────────────────────────────────────────────────
// NodeZero self-hosted Waku node (nwaku) — staging-testnet messaging backbone
//
// Single-replica Container App running TWO nwaku containers that share the
// replica's network namespace (localhost):
//   1. `nwaku`      — service node: relay + filter + lightpush + store, with a
//                     pinned nodekey so the bootstrap peer id (and therefore
//                     NZ_WAKU_BOOTSTRAP_PEERS) is stable across restarts.
//                     js-waku light clients dial its WebSocket port through
//                     the ACA HTTPS ingress (wss on 443 → 8000).
//   2. `nwaku-peer` — relay-mesh peer: a lone nwaku node rejects lightpush
//                     with NoPeersToPublish because gossipsub requires >=1
//                     relay peer. This container discovers the service node's
//                     peer id via its local REST API and static-dials it over
//                     127.0.0.1, completing the mesh. Validated locally by
//                     scripts/waku-spike/docker-compose.yml (7/7 spike PASS).
//
// Private cluster (default id 0, shard 0) — deliberately NOT The Waku
// Network: no RLN, no public discovery; light clients connect only via
// NZ_WAKU_BOOTSTRAP_PEERS. The REST port (8645) is used for container health
// probes and localhost peer discovery only; it is never exposed by ingress.
//
// Scope: testnet/staging-testnet only. Store retention is short-window
// catch-up (sqlite on ephemeral disk) — durable history lives in Solid Pods.
// ─────────────────────────────────────────────────────────────────────────────

@description('Deployment location for all resources.')
param location string = resourceGroup().location

@description('Short environment identifier. Production intentionally unsupported by this module.')
@allowed([
  'testnet'
  'staging-testnet'
])
param environmentName string = 'staging-testnet'

@description('Global application name prefix.')
@minLength(3)
param appName string = 'nodezero-social'

@description('Pinned nwaku container image. Must match the version validated by the local spike.')
param nwakuImage string = 'docker.io/wakuorg/nwaku:v0.36.0'

@description('Fixed secp256k1 nodekey (64 hex chars) for the service node so its peer id — and NZ_WAKU_BOOTSTRAP_PEERS — is stable across restarts. Supply via AZURE_WAKU_NODEKEY; never commit it.')
@secure()
@minLength(64)
param wakuNodeKey string

@description('Waku cluster id for the private NodeZero cluster. Must match the js-waku clients\' WakuTransportOptions.clusterId (default 0).')
@minValue(0)
param wakuClusterId int = 0

@description('Store retention window in seconds (offline catch-up only; Pods are the durable plane).')
@minValue(60)
@maxValue(86400)
param storeRetentionSeconds int = 3600

@description('Optional custom domain host for the wss bootstrap endpoint (for example, waku-staging.nodezero.social). Leave empty to use the default ACA ingress domain.')
param wakuCustomDomain string = ''

@description('vCPU cores for the service node container.')
param serviceCpu string = '0.75'

@description('Memory for the service node container.')
param serviceMemory string = '1.5Gi'

@description('vCPU cores for the relay-mesh peer container.')
param peerCpu string = '0.25'

@description('Memory for the relay-mesh peer container.')
param peerMemory string = '0.5Gi'

@description('Log Analytics retention period in days.')
@minValue(30)
@maxValue(90)
param logAnalyticsRetentionDays int = 30

@description('Daily ingestion cap (GB) for the Log Analytics workspace.')
@minValue(1)
@maxValue(10)
param logAnalyticsDailyQuotaGb int = 1

var logAnalyticsName = '${appName}-${environmentName}-waku-law'
var managedEnvName = '${appName}-${environmentName}-waku-env'
// ACA Container App names are capped at 32 chars; keep this short.
var containerAppName = 'nz-${environmentName}-waku'

var commonTags = {
  application: appName
  environment: environmentName
  component: 'waku-node'
  runtimeBoundary: 'non-production'
  costGuardrail: 'enabled'
}

// The service node reads its nodekey from a secret-backed env var so the key
// never appears in container args (which are visible in the template).
var serviceNodeScript = 'exec /usr/bin/wakunode --nodekey="$NZ_WAKU_NODEKEY" --relay=true --filter=true --lightpush=true --store=true --store-message-retention-policy=time:${storeRetentionSeconds} --rest=true --rest-address=0.0.0.0 --rest-port=8645 --websocket-support=true --websocket-port=8000 --tcp-port=60000 --listen-address=0.0.0.0 --nat=extip:127.0.0.1 --cluster-id=${wakuClusterId} --shard=0 --log-level=INFO'

// The relay-mesh peer discovers the service node's peer id at runtime over
// localhost REST (containers in one ACA replica share a network namespace),
// then static-dials 127.0.0.1:60000. It binds tcp 60001 to avoid a port
// collision in the shared namespace and exposes no REST/WebSocket/store.
var relayPeerScript = 'until wget -qO /tmp/info.json http://127.0.0.1:8645/debug/v1/info; do sleep 1; done; PEER=$(sed -n \'s|.*/p2p/\\([A-Za-z0-9]*\\).*|\\1|p\' /tmp/info.json | head -1); echo "relay mesh dialing peer id: $PEER"; exec /usr/bin/wakunode --relay=true --tcp-port=60001 --listen-address=0.0.0.0 --nat=extip:127.0.0.1 --cluster-id=${wakuClusterId} --shard=0 --staticnode=/ip4/127.0.0.1/tcp/60000/p2p/$PEER --log-level=INFO'

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

var baseHostRaw = empty(wakuCustomDomain) ? '${containerAppName}.${managedEnv.properties.defaultDomain}' : wakuCustomDomain
var baseHost = endsWith(baseHostRaw, '/') ? substring(baseHostRaw, 0, max(length(baseHostRaw) - 1, 0)) : baseHostRaw

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  tags: commonTags
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      secrets: [
        {
          name: 'waku-nodekey'
          value: wakuNodeKey
        }
      ]
      ingress: {
        external: true
        targetPort: 8000
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
          name: 'nwaku'
          image: nwakuImage
          resources: {
            cpu: json(serviceCpu)
            memory: serviceMemory
          }
          command: ['/bin/sh']
          args: ['-c', serviceNodeScript]
          env: [
            {
              name: 'NZ_WAKU_NODEKEY'
              secretRef: 'waku-nodekey'
            }
          ]
          probes: [
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8645
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8645
              }
              initialDelaySeconds: 15
              periodSeconds: 30
            }
          ]
        }
        {
          name: 'nwaku-peer'
          image: nwakuImage
          resources: {
            cpu: json(peerCpu)
            memory: peerMemory
          }
          command: ['/bin/sh']
          args: ['-c', relayPeerScript]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output wakuFqdn string = containerApp.properties.configuration.ingress.fqdn
output wakuHost string = baseHost
output containerAppName string = containerApp.name
output logAnalyticsName string = logAnalytics.name
// The peer id comes from the pinned nodekey; the deploy script extracts it
// from container logs and substitutes it into this template.
output bootstrapMultiaddrTemplate string = '/dns4/${baseHost}/tcp/443/wss/p2p/<PEER_ID>'
