# Open-Source Readiness Assessment

**Date:** 2026-07-01  
**Environment assessed:** `staging-testnet` branch + live `staging.nodezero.social`  
**Assessment method:** Live Playwright E2E validation, stellar.expert on-chain evidence, source code analysis.

---

## Verdict

**Developer-preview ready.** The codebase has a complete, working, genuinely ZK-powered implementation deployed on live infrastructure. The foundations for OSS publication are solid. A small set of improvements — documented below with priority — would make this a clean first public release.

---

## What is already good

| Area | Evidence |
|---|---|
| **MIT licence** | `LICENSE` |
| **Security policy** | `SECURITY.md` — private reporting path + SLA |
| **Community safety** | `CODE_OF_CONDUCT.md` — Contributor Covenant |
| **Contribution guide** | `CONTRIBUTING.md` — prerequisites, checks, review process |
| **PR / issue templates** | `.github/PULL_REQUEST_TEMPLATE.md`, issue templates |
| **CI pipeline** | `.github/workflows/ci.yml` — lint, type-check, test, contract cargo test, policy guard |
| **Monorepo tooling** | `pnpm-workspace.yaml`, corepack, shared tsconfig |
| **Environment isolation** | `scripts/policy/validate-env-isolation.sh` enforces staging ≠ mainnet; zero cross-env leakage in CI |
| **ZK is load-bearing** | Real Groth16 `pod_ownership` proof generated in-browser; `accountCommitment = Poseidon(identitySecret)` anchored on-chain (`get_account_commitment` confirmed stellar.expert, `storage_entries:5`) |
| **Fail-closed auth** | Onboarding refuses to sign in without a real lockb0x + attestation; returning login checks on-chain commitment — mismatches refused |
| **No secrets in repo** | All runtime secrets in Azure Key Vault + GitHub environment secrets; `docs/dev-only/` is gitignored |
| **Non-reproducibility documented** | The wasm build is non-deterministic (noted in roadmap); the deployed hash is tracked in `deployments/stellar-testnet.contracts.json` |

---

## Priority improvements before broad publication

### 1. README (done — 2026-07-01)
The README now reflects the real deployed system: architecture diagram, package map, ZK flow, status table, and deployment references. The hackathon submission context has been removed.

### 2. CHANGELOG.md (high)
There is no public changelog. Recommended: add `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/) format, with one entry per meaningful milestone. The roadmap (`docs/staging-runtime-implementation-roadmap.md`) already has detailed evidence; a public changelog would be a summarised subset.

### 3. GOVERNANCE.md and MAINTAINERS.md (medium)
No governance or maintainers document. For an identity/social-graph project with trust implications, a short `GOVERNANCE.md` naming the decision process and `MAINTAINERS.md` naming current owners and escalation paths would significantly raise trust.

### 4. docs/architecture.md (medium)
The system architecture is described in the README and roadmap, but a standalone `docs/architecture.md` with a deeper threat-model section (key custody, relay trust, Azure dependency, on-chain vs off-chain trust boundary) is expected by contributors working in the identity/Solid/Stellar space.

### 5. Dependency update policy (medium)
There is no Dependabot / Renovate configuration. For a project pulling `@stellar/stellar-sdk`, `snarkjs`, `expo`, and Soroban SDK, automated dependency PRs are important for security posture.

### 6. Good-first-issue labels (low)
Once the repo is public, applying `good first issue` labels to appropriate GitHub issues would improve contribution funnel.

---

## Solid / identity trust model clarity

For contributors and security reviewers in the Solid ecosystem:

| Question | Current answer |
|---|---|
| **Identity model** | WebID (Solid) anchored to a Stellar keypair on-chain via `NodeZeroIdentity.register_webid` + `Lockb0x.accountCommitment`. ZK proof (`pod_ownership`) binds the device secret to the claim at creation and on every return. |
| **Data portability** | Profile and social graph live in the user's Solid Pod (CSS). The Pod is portable. The `nodezero-account.json` and `profile/card` anchor triples hold the on-chain references. |
| **Interoperability** | Solid OIDC for sign-in; `foaf:` / `solid:` profile triples preserved; Stellar Soroban for on-chain state; Groth16/BN254 ZK matching the existing `PoHVerifier` contract. |
| **Access control** | User's Solid Pod owns its ACL. The provisioner writes to the Pod at creation using short-lived DPoP client credentials; it does not retain long-term write access. |
| **Trust boundary** | CSS Pod server + Azure provisioner are trusted for the creation step. The Stellar lockb0x is public and verifiable by anyone. The ZK commitment is trustless. On returning login the browser verifies the device identity against the on-chain anchor — the provisioner is not in the loop. |
| **Privacy** | The encrypted `attestationCiphertext` on-chain is recoverable only by the Stellar keypair holder. The `accountCommitment` is public but reveals nothing without the secret. The provisioner logs are retained for debugging; they should be subject to a retention policy before production. |

---

## Technical debt (not blocking)

| Item | File | Severity |
|---|---|---|
| Pre-existing lint errors in `compose.tsx`, `docustream.tsx`, `backpack.tsx`, `local.tsx`, `settings.tsx` | `packages/mobile-app/app/` | Medium — should be fixed before mainnet |
| `PoHVerifier` negative tests need `panic_with_error!` refactor to pass `cargo test` cleanly | `packages/contracts/src/poh_verifier.rs` | Low — 3 tests currently `#[ignore]`; logic is correct on-chain |
| `register_webid` is not called in the seamless onboarding path | `packages/embedded-wallet/src/WalletService.ts` | Low — `NodeZeroIdentity` is populated via OIDC path; seamless path uses Lockb0x commitment only |
| Feed / social graph is a placeholder | `packages/mobile-app/app/feed.tsx` | Known gap, not blocking |

---

## Open-source publication checklist

- [x] MIT licence
- [x] `SECURITY.md`
- [x] `CODE_OF_CONDUCT.md`
- [x] `CONTRIBUTING.md`
- [x] PR + issue templates
- [x] CI with lint / type-check / test / policy
- [x] Environment isolation enforced by policy script
- [x] No secrets in repository
- [x] README reflects current deployed system
- [x] Deployment contract IDs tracked in `deployments/`
- [ ] `CHANGELOG.md`
- [ ] `GOVERNANCE.md` + `MAINTAINERS.md`
- [ ] `docs/architecture.md` (threat model section)
- [ ] Dependabot / Renovate configuration
- [ ] Pre-publish lint pass (resolve pre-existing mobile-app errors)