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
- Blocking onboarding/authentication E2E gate (`pnpm qa:smoke:auth`) with one
	retry for transient IdP/OIDC timing churn.
- Latest staging deploy evidence: workflow run `#46` completed with auth gate
	success (`step #28`).

## ACL Hardening Rollout Runbook (Staging)

Rollout order:
1. Build hardened Solid runtime image.
2. Deploy staging in `shadow` mode.
3. Review and triage deny candidates.
4. Remediate legacy malformed ACL data.
5. Promote staging to `enforce` mode.

Commands:
- `bash ./scripts/azure/build-solid-themed-image.sh`
- `bash ./scripts/azure/deploy-solid-server.sh`
- `corepack pnpm policy:validate-env`

Identity endpoint continuity check (required after every Solid deploy):
1. Confirm the Solid custom hostname remains bound to ACA ingress.
2. Validate OIDC discovery over the custom domain returns HTTP 200.

Commands:
- `az containerapp hostname list --resource-group rg-nodezero-social-staging-testnet --name nz-staging-testnet-solid -o json`
- `curl -i https://solid.nodezero.social/.well-known/openid-configuration`

Failure signature:
- Browser sign-in/onboarding shows `Failed to fetch`.
- Browser console/network shows `ERR_CONNECTION_RESET` for `https://solid.nodezero.social/.well-known/openid-configuration`.

Operational safeguard:
- `scripts/azure/deploy-solid-server.sh` now enforces managed-certificate + hostname binding for `cssCustomDomain` after each deployment so the custom domain does not silently drop.
- `scripts/azure/deploy-solid-server.sh` hard-fails deployment when `cssCustomDomain` resolves to `solid.nodezero.social` and the effective `cssImage` is not the NodeZero themed image family (`/solid/community-server-nodezero-auth-ui:<tag>`).

Required evidence:
- Image reference and build timestamp.
- Azure deployment operation ID(s).
- Shadow start timestamp.
- Enforce cutover timestamp.

Rollback:
1. Switch policy mode back to `shadow`.
2. Keep telemetry capture enabled.
3. Record incident with violating `ruleId` values and sample `correlationId`s.

## Runbooks

- `docs/staging-deployment-blueprint.md`
- `docs/environment-isolation-matrix.md`
- `docs/staging-readiness-and-agent-plan.md`
- `docs/staging-runtime-implementation-roadmap.md`
- `docs/archive/2026-pre-staging/testnet-azure-release-requirements.md` (archived)
