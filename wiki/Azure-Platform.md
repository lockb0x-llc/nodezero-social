# Azure Platform

Infrastructure and deployment automation for staging environments are defined in Azure Bicep and scripts.

## Key files

- `infrastructure/azure/main.bicep`
- `infrastructure/azure/main.parameters.staging-testnet.json`
- `scripts/azure/deploy.sh`
- `.github/workflows/staging-deploy.yml`

## Guardrails

- Mandatory parameter file enforcement.
- Environment mismatch rejection.
- What-if preflight before deployment.

## Runbooks

- `docs/staging-deployment-blueprint.md`
- `docs/environment-isolation-matrix.md`
