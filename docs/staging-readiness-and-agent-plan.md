# NodeZero Staging Readiness Review and Agent Operating Plan

Date: 2026-06-24
Target: staging.nodezero.social on Stellar TestNet and Azure

## 1) Repository purpose and product shape

NodeZero is a decentralized social application that combines:
- Solid Pods for user-owned profile and social graph data.
- Stellar Soroban smart contracts for identity anchoring and ZK state root management.
- ZK artifacts/circuits for Stellar<->Solid pairing attestation flows.
- Expo mobile/web app UI as the user-facing product.
- Azure infrastructure as the hosting and operational plane.

## 2) Current technical stack

- Monorepo tooling: pnpm workspaces, TypeScript, ESLint, Jest (partial), Rust (contracts).
- App runtime: Expo Router + React Native + React for web/mobile.
- Identity/data layer: @inrupt Solid libraries.
- Wallet/chain: @stellar/stellar-sdk and Soroban contract deployment scripts.
- Infra IaC: Azure Bicep template in infrastructure/azure/main.bicep.
- Deployment scripts:
  - scripts/zk/prepare-testnet.sh
  - scripts/stellar/deploy-testnet.sh
  - scripts/azure/deploy.sh

## 3) Infrastructure requirements (staging)

### Stellar TestNet requirements
- Stellar CLI 27.x installed and authenticated.
- Rust target wasm32v1-none.
- Funded Stellar source account alias for testnet deployment.
- Contract deployment output persisted in deployments/stellar-testnet.contracts.json.

### Azure requirements
- Azure subscription + existing resource group.
- Azure CLI with Bicep enabled.
- Bicep parameters file with real contract IDs and ZK URLs.
- Azure resources currently provisioned by Bicep:
  - Log Analytics
  - App Insights
  - Storage Account
  - Key Vault
  - Static Web App

### Domain and DNS requirements
- staging.nodezero.social DNS ownership and zone access.
- CNAME binding from staging.nodezero.social to Azure Static Web App hostname.
- TLS certificate validation in Azure Static Web App custom domains.

## 4) Deployment readiness summary

Status: Not ready for staging release yet.

Readiness by area:
- Smart contracts and artifact pipeline: Partially ready.
- Mobile/web application functionality: Partially ready with major placeholders.
- Azure infrastructure provisioning: Basic ready, missing staging-grade controls and publishing automation.
- CI/CD and release governance: Not ready.

## 5) Key gaps to close before staging

1. Feed and local-node messaging are placeholders in mobile UI.
2. Solid profile interests handling reads only one value, not a full list.
3. Solid auth path in mobile uses browser redirect assumptions that are not mobile-safe without platform-specific handling.
4. No relay server implementation in this repo for SignalRelay WebSocket endpoint.
5. No CI/CD workflows present for repeatable build/test/deploy gates.
6. Azure IaC does not include custom domain wiring and production-grade hardening controls.
7. Root workspace test script can fail because some packages do not define test scripts.
8. Package manifest issue in solid-pod-sync (duplicate peerDependencies key with overwrite risk).

## 6) Roadmap to staging.nodezero.social (Stellar TestNet + Azure)

### Phase 0: Stabilize build and policy (1-2 days)
- Fix package manifest issues and standardize scripts in every package.
- Add CI checks for lint/type-check/test and contract unit tests.
- Add release checklist and environment variable contract.

### Phase 1: Complete core product behaviors (3-5 days)
- Implement real feed aggregation from social graph + Pod post containers.
- Implement P2P local broadcast with actual channel lifecycle.
- Add relay service deployment target (Azure Container Apps/App Service).
- Make Solid auth flow platform-aware for Expo web and native.

### Phase 2: Chain + ZK deployment hardening (2-3 days)
- Add idempotent contract deployment with explicit init/config actions.
- Validate generated manifests and publish signed artifact checksums.
- Add rollback and re-deploy procedures for testnet contracts.

### Phase 3: Azure staging hardening (2-4 days)
- Add custom domain, TLS, diagnostics, alerts, and budget guardrails.
- Add SWA deployment automation from Expo web build artifact.
- Add Key Vault access policies/managed identity integration for runtime consumers.

### Phase 4: Staging validation and go-live (2-3 days)
- End-to-end smoke tests (auth, profile save/load, feed, local node, wallet registration).
- Synthetic monitoring and health dashboard.
- Sign-off and launch staging.nodezero.social.

## 7) Agent operating model

See .agents for executable instructions:
- .agents/README.md
- .agents/project-manager/todo.md
- .agents/shared-inbox/inbox.md
- .agents/agents/*.md

Operating principles:
- Project Manager owns scope, sequencing, and release quality bar.
- Specialists own implementation in domain boundaries.
- Every task must produce acceptance evidence and inbox updates.
- Cross-agent handoffs are mandatory before PM marks a todo as done.
