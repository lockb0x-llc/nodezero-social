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

@description('Service Bus pricing tier for notification orchestration.')
@allowed([
  'Standard'
  'Premium'
])
param serviceBusSku string = 'Standard'

@description('Lifecycle event topic name consumed by notification workers.')
param lifecycleTopicName string = 'lifecycle-events'

@description('Digest work queue name for scheduler/worker fan-out.')
param digestQueueName string = 'digest-work-items'

@description('Queue name for delayed schedule intents (scheduler-ready staging pattern).')
param digestScheduleQueueName string = 'digest-schedule-intents'

@description('Topic subscription used by orchestrator workers.')
param orchestratorSubscriptionName string = 'notification-orchestrator'

@description('Days to retain duplicate detection history.')
@minValue(1)
@maxValue(7)
param duplicateDetectionHistoryDays int = 1

var resourceToken = toLower(uniqueString(resourceGroup().id, appName, environmentName, 'notifications'))
var namespaceName = take('sb${replace(appName, '-', '')}${replace(environmentName, '-', '')}${resourceToken}', 50)
var commonTags = {
  application: appName
  environment: environmentName
  component: 'notifications'
  runtimeBoundary: 'non-production'
  costGuardrail: 'enabled'
}

resource namespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: namespaceName
  location: location
  sku: {
    name: serviceBusSku
    tier: serviceBusSku
  }
  tags: commonTags
  properties: {
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    zoneRedundant: false
  }
}

resource lifecycleTopic 'Microsoft.ServiceBus/namespaces/topics@2022-10-01-preview' = {
  name: lifecycleTopicName
  parent: namespace
  properties: {
    defaultMessageTimeToLive: 'P14D'
    maxSizeInMegabytes: 1024
    requiresDuplicateDetection: true
    duplicateDetectionHistoryTimeWindow: 'P${string(duplicateDetectionHistoryDays)}D'
    enablePartitioning: false
  }
}

resource lifecycleSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2022-10-01-preview' = {
  name: orchestratorSubscriptionName
  parent: lifecycleTopic
  properties: {
    maxDeliveryCount: 10
    deadLetteringOnMessageExpiration: true
    lockDuration: 'PT1M'
    defaultMessageTimeToLive: 'P14D'
  }
}

resource digestQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  name: digestQueueName
  parent: namespace
  properties: {
    maxDeliveryCount: 10
    deadLetteringOnMessageExpiration: true
    lockDuration: 'PT1M'
    defaultMessageTimeToLive: 'P14D'
    enablePartitioning: false
  }
}

resource digestScheduleQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  name: digestScheduleQueueName
  parent: namespace
  properties: {
    maxDeliveryCount: 10
    deadLetteringOnMessageExpiration: true
    lockDuration: 'PT1M'
    defaultMessageTimeToLive: 'P14D'
    enablePartitioning: false
  }
}

resource senderPolicy 'Microsoft.ServiceBus/namespaces/AuthorizationRules@2022-10-01-preview' = {
  name: 'notification-sender'
  parent: namespace
  properties: {
    rights: [
      'Send'
    ]
  }
}

resource processorPolicy 'Microsoft.ServiceBus/namespaces/AuthorizationRules@2022-10-01-preview' = {
  name: 'notification-processor'
  parent: namespace
  properties: {
    rights: [
      'Listen'
      'Send'
    ]
  }
}

output serviceBusNamespaceName string = namespace.name
output lifecycleTopicName string = lifecycleTopic.name
output orchestratorSubscriptionName string = lifecycleSubscription.name
output digestQueueName string = digestQueue.name
output digestScheduleQueueName string = digestScheduleQueue.name
output senderPolicyName string = senderPolicy.name
output processorPolicyName string = processorPolicy.name
