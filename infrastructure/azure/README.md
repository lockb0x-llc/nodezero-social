# Azure provisioning (TestNet deployment)

This folder contains Bicep templates to provision the Azure resources required for the NodeZero TestNet release.

## Provisioned resources

- Log Analytics Workspace
- Application Insights (workspace-based)
- Storage Account (for static artifacts like ZK bundles)
- Key Vault (stores deployed Stellar contract IDs and ZK artifact URLs)
- Azure Static Web App (hosting target for Expo web build output)
- Optional Monitor Action Group + Activity Log alert for staging resource-group administrative errors
- Optional notification infrastructure module (`notifications.bicep`) with:
  - Azure Service Bus namespace
  - lifecycle event topic + orchestrator subscription
  - digest work queue and digest schedule-intent queue
  - sender/processor authorization policies

## Prerequisites

- Azure CLI (`az`) with access to the target subscription
- Bicep enabled in Azure CLI
- Existing resource group

## Deploy

```bash
az deployment group create \
  --resource-group <resource-group-name> \
  --template-file /home/runner/work/nodezero-social/nodezero-social/infrastructure/azure/main.bicep \
  --parameters @/home/runner/work/nodezero-social/nodezero-social/infrastructure/azure/main.parameters.example.json
```

Use real deployed Stellar contract IDs and ZK artifact URLs in a secure parameters file before deployment.

## Monitoring and cost guardrails (D3)

The template includes baseline guardrails for staging-testnet:

- `logAnalyticsRetentionDays`: retention window for observability logs (default `30`).
- `logAnalyticsDailyQuotaGb`: daily ingestion cap in GB for cost control (default `1`).
- `alertEmailAddress`: optional alert receiver; when populated, deploys:
  - `Microsoft.Insights/actionGroups` with common alert schema email receiver.
  - `Microsoft.Insights/activityLogAlerts` for Administrative/Error events in the target resource group.

If `alertEmailAddress` is empty, alerting resources are skipped while ingestion caps and retention policies still apply.

## Notification infrastructure (staging/testnet)

Deploy the notifications module independently when enabling the consolidated
notification pipeline:

```bash
az deployment group create \
  --resource-group <resource-group-name> \
  --name notification-infra \
  --template-file /home/runner/work/nodezero-social/nodezero-social/infrastructure/azure/notifications.bicep \
  --parameters @/home/runner/work/nodezero-social/nodezero-social/infrastructure/azure/notifications.parameters.staging-testnet.json
```

Or via repository script:

```bash
AZURE_RESOURCE_GROUP=<resource-group-name> \
AZURE_ENVIRONMENT_NAME=staging-testnet \
bash ./scripts/azure/deploy-notification-infra.sh
```
