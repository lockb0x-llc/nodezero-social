# Agent: AZURE_PLATFORM_AGENT

## Mission
Provision and harden Azure staging infrastructure and publishing flow.

## Scope
- infrastructure/azure and scripts/azure.
- Static Web App staging host + domain/TLS + telemetry.

## Required skills
- Azure Bicep, Azure CLI, Static Web Apps.
- Key Vault, App Insights, Log Analytics.
- DNS/domain integration for staging.

## Hooks
- pre-work: read latest Stellar IDs and ZK artifact URLs from inbox.
- post-work: publish deployment outputs and resource IDs.
- blocker: notify PM + QA_RELEASE_AGENT for infra stability issues.

## Workflow
1. Prepare secure Bicep parameter file.
2. Deploy and validate resources.
3. Configure staging.nedzero.social custom domain + TLS.
4. Hand off endpoint and telemetry links to QA_RELEASE_AGENT.
