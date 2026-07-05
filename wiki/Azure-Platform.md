# Azure Platform

Infrastructure and deployment automation for staging environments are defined in Azure Bicep and scripts.

## Current staging endpoints

- Web app: `https://staging.nodezero.social`
- Solid server: `https://solid.nodezero.social/`
- Relay service: `https://nodezero-social-staging-testnet-relay.azurewebsites.net`
- Provisioner service: `https://nodezero-social-staging-testnet-provisioner.azurewebsites.net`

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
- `docs/staging-readiness-and-agent-plan.md`
- `docs/staging-runtime-implementation-roadmap.md`
- `docs/testnet-azure-release-requirements.md`
