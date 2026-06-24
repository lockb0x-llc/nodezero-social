# Azure provisioning (TestNet deployment)

This folder contains Bicep templates to provision the Azure resources required for the NodeZero TestNet release.

## Provisioned resources

- Log Analytics Workspace
- Application Insights (workspace-based)
- Storage Account (for static artifacts like ZK bundles)
- Key Vault (stores deployed Stellar contract IDs and ZK artifact URLs)
- Azure Static Web App (hosting target for Expo web build output)

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
