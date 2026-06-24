# Shared Inbox

Format:
[YYYY-MM-DD HH:MM UTC] [FROM->TO] [P0|P1|P2] [OPEN|NEEDS-INFO|DONE]
Context:
Request:
Evidence:
Due:

---

[2026-06-24 00:00 UTC] [PROJECT_MANAGER->ALL] [P1] [OPEN]
Context: Kick off staging readiness initiative for Stellar TestNet + Azure.
Request: Each agent review its scope and post first risk report.
Evidence: docs/staging-readiness-and-agent-plan.md
Due: 2026-06-25 18:00 UTC

[2026-06-24 15:10 UTC] [PROJECT_MANAGER->STELLAR_CONTRACT_AGENT] [P1] [OPEN]
Context: Implementation started for environment guardrails and chain deployment safety.
Request: Validate strict TestNet tuple enforcement and idempotent alias-based contract resolution flow in scripts/stellar/deploy-testnet.sh.
Evidence: scripts/stellar/deploy-testnet.sh
Due: 2026-06-25 12:00 UTC

[2026-06-24 15:10 UTC] [PROJECT_MANAGER->AZURE_PLATFORM_AGENT] [P1] [OPEN]
Context: Implementation started for Azure deployment isolation policy.
Request: Validate mandatory parameter-file requirement, what-if preflight, and environment mismatch rejection in scripts/azure/deploy.sh and bicep environment constraints.
Evidence: scripts/azure/deploy.sh; infrastructure/azure/main.bicep
Due: 2026-06-25 12:00 UTC

[2026-06-24 15:10 UTC] [PROJECT_MANAGER->MOBILE_APP_AGENT] [P1] [OPEN]
Context: Runtime policy enforcement started for staging/mainnet separation.
Request: Validate strict profile checks in packages/mobile-app/app.config.js and runtime coherence assertions in packages/mobile-app/src/contexts/WalletContext.tsx.
Evidence: packages/mobile-app/app.config.js; packages/mobile-app/src/contexts/WalletContext.tsx
Due: 2026-06-25 12:00 UTC
