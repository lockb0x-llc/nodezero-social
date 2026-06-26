# Project Manager Todo Board

## Status legend
- TODO
- IN_PROGRESS
- BLOCKED
- DONE

## Milestone A: Build and release hygiene
- [DONE] A1: Normalize package scripts and fix manifest anomalies.
- [DONE] A2: Add CI pipelines for lint, type-check, test, contracts.
- [DONE] A3: Define release environment variable matrix for staging.

## Milestone B: Functional completion
- [IN_PROGRESS] B1: Replace feed placeholder with Solid-based aggregation.
- [IN_PROGRESS] B2: Replace local chat placeholder with live P2P relay flow.
- [DONE] B3: Deliver relay backend for SignalRelay endpoint. (merged to main: /health + /healthz + Dockerfile)
- [DONE] B4: Make Solid auth cross-platform safe for Expo web/native. (merged to main: IdP validation, env coherence, safer redirect)

## Milestone C: Chain and ZK reliability
- [DONE] C1: Harden contract deployment sequence and initialization. (merged to main: Lockb0x initialization-proof gate)
- [IN_PROGRESS] C2: Publish artifact manifest validation and checksum process.

## Milestone D: Azure staging readiness
- [BLOCKED] D1: Add custom domain/TLS configuration runbook. (Azure DNS zone + staging CNAME provisioned; blocked on correct Namecheap API user/API access or registrar NS delegation to Azure DNS)
- [DONE] D2: Add SWA publish workflow from Expo web build. (merged to main: build:web + SWA publish + landing smoke)
- [TODO] D3: Add monitoring/alerting and cost guardrails.

## Milestone E: Validation and launch
- [DONE] E1: End-to-end smoke suite and manual UAT checklist. (merged to main: scripts/qa/staging-smoke.sh + docs/staging-uat-checklist.md + qa:smoke)
- [TODO] E2: Staging sign-off and release announcement.

## Milestone F: Multi-agent parallel delivery ops
- [DONE] F1: Add PM branch/worktree dispatch automation.
- [DONE] F2: Add PM merge-queue reintegration automation.
- [DONE] F3: Add PM status and follow-up control loop.
- [DONE] F4: Add bounded PM loop mode for recurring oversight.

## Milestone H: CI/CD Incident remediation (user-escalated P0)
- [DONE] H1: Fix pnpm version mismatch — upgrade CI to pnpm v11 in ci.yml and staging-deploy.yml. (commit 45263d7)
- [DONE] H2: Pin Rust toolchain — add packages/contracts/rust-toolchain.toml (Rust 1.81.0 stable). (commit 45263d7)
- [DONE] H3: Fix Namecheap API credentials — maintainer updated NAMECHEAP_API_KEY and NAMECHEAP_API_USER GitHub secrets. (2026-06-25)
- [DONE] H4: Branch governance — created `testnet` integration branch; dispatch/reintegrate scripts default to testnet; RUNBOOK section 6a documents new flow; branch protection rules set on main (enforcement limited to public-repo-only on Free plan). Agent work now targets testnet; PM opens testnet→main PRs after QA sign-off.

## Milestone I: Next sprint (testnet-first)
- [TODO] I1: Keep testnet current — merge main into testnet at start of each sprint.
- [TODO] I2: Agent branches created off testnet, not main.
- [TODO] I3: PM opens testnet→main PR only after QA_RELEASE_AGENT posts explicit PASS.

## Milestone J: QA-identified bug fixes and gap closures (2026-06-25)
- [DONE] J1: Fix wallet provisioning on web — Platform.OS === 'web' guard in WalletContext.tsx skips expo-secure-store on web. (commit 778c37f, testnet)
- [DONE] J2: Fix auth error message specificity — client-side empty URL and non-HTTPS checks in index.tsx. (commit 778c37f, testnet)
- [TODO] J3: Add favicon to Expo web export. Owner: MOBILE_APP_AGENT. Low priority.
- [TODO] J4: Complete LM1/LM2/WR2/AU4 authenticated UAT — requires X5 fix first.
- [TODO] J5: DOCS_AGENT to document confirmed functionality and gaps.
- [DONE] J6 (P1): Web navigation bar added to _layout.tsx — WebNavBar renders on Platform.OS==='web' when isLoggedIn. Feed/Local/Profile/Settings links with active state. (commit 9118ac7, merged to testnet)
- [DONE] J7 (P1): index.tsx redirect now guards on pathname==='/' — prevents authenticated users at /settings, /local, /profile from being bounced to /feed. (commit 9118ac7, merged to testnet)
- [DONE] G1: Author open-source community health files (LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue templates, PR template). (merged to main)
- [DONE] G2: Build GitHub Wiki with architecture overview, feature guides, getting-started, API references, and roadmap. (merged to main with wiki/_Sidebar.md navigation)
- [DONE] G3: Playwright-validated walkthroughs with screenshots and video embedded in Wiki pages. (merged to main with docs/screenshots/README.md index)

## Milestone K: Lockb0x attestation implementation (2026-06-26)
- [DONE] K1: Rewrite PoH-first documentation and product copy to lockb0x attestation scope. Owners: DOCS_AGENT, MOBILE_APP_AGENT, STELLAR_CONTRACT_AGENT.
- [IN_PROGRESS] K2: Wire onboarding flow to register WebID<->Stellar pairing and persist attestation inputs. Owners: MOBILE_APP_AGENT, SOLID_DATA_AGENT.
- [IN_PROGRESS] K3: Add client-side chain reads for pairing verification (`get_webid`, `get_state_root`) with existing contracts only. Owner: STELLAR_CONTRACT_AGENT.
- [IN_PROGRESS] K4: Implement returning sign-in pairing verification against lockb0x-root-backed attestation proof. Owners: MOBILE_APP_AGENT, SOLID_DATA_AGENT. (code path added; pending staging verification)
- [IN_PROGRESS] K5: Validate staging deployment, UAT matrix, and release evidence for attestation flow. Owners: QA_RELEASE_AGENT, AZURE_PLATFORM_AGENT, DOCS_AGENT. (checklist updated with attestation cases; execution pending)
