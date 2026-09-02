# NodeZero Social — Documentation Index

**Index verified:** 2026-09-01 against `testnet` @ `3cb6450`
**Deployed staging:** `https://staging.nodezero.social` — workflow run `33284499441`

Every entry carries a status tag. Consolidated and re-indexed 2026-09-01 following
independent Audit, QA Release, and Docs agent reviews.

| Tag | Meaning |
|---|---|
| **Authoritative** | Normative. Changing it requires an ADR or new evidence |
| **Living** | Current status; expected to change as work lands |
| **Historical** | Immutable evidence. Accurate for its date only; never rewritten |
| **External** | Third-party analysis. Not a NodeZero statement |

---

## Start here

| Document | Purpose | Tag |
|---|---|---|
| [executive-summary.md](executive-summary.md) | What NodeZero is, what actually ships today, and what does not exist | **Living** |
| [roadmap.md](roadmap.md) | Verified milestone status and the sequenced plan to a production RC | **Living** |

> ⚠️ Documentation prior to 2026-09-01 overstated delivery in several places. The executive
> summary and roadmap record the corrected status and name what was wrong.

---

## Authoritative

| Document | Purpose |
|---|---|
| [system-description.md](system-description.md) | Product purpose, trust posture, capability state, scope |
| [architecture.md](architecture.md) | Component boundaries, runtime flows, trust boundaries, threat model |
| [environment-isolation-matrix.md](environment-isolation-matrix.md) | `local` / `staging-testnet` / `production-mainnet` separation rules |
| [consentful-pod-owner-discovery-and-communication-plan.md](consentful-pod-owner-discovery-and-communication-plan.md) | Milestone Q execution plan |
| [adrs/README.md](adrs/README.md) | Architecture decision records |

---

## Standards and conformance

**Read [known-non-conformance.md](standards/known-non-conformance.md) before citing any
conformance claim from this repository.**

| Document | Purpose |
|---|---|
| [standards/README.md](standards/README.md) | Scope, rules, and the publication gate |
| [standards/conformance-matrix.md](standards/conformance-matrix.md) | One row per standard: level, module, tests, caveats |
| [standards/known-non-conformance.md](standards/known-non-conformance.md) | Dated, severity-ranked gaps (NC-01 … NC-10) |
| [standards/did-pkn-method.md](standards/did-pkn-method.md) | The `did:pkn` W3C DID method specification |
| [standards/solid-webid-and-type-index.md](standards/solid-webid-and-type-index.md) | Solid Protocol, WebID, Type Indexes, and the no-browser-OIDC deviation |
| [standards/ldn-and-activitystreams.md](standards/ldn-and-activitystreams.md) | LDN inbox semantics and the AS2 relationship profile |
| [standards/webauthn-prf.md](standards/webauthn-prf.md) | WebAuthn Level 3 PRF design — **primitive only, not in use** |
| [standards/zk-attestation.md](standards/zk-attestation.md) | Groth16/BN254 attestation and its off-chain trust boundary |

---

## Process and operations

| Document | Purpose |
|---|---|
| [process/ci-and-gates.md](process/ci-and-gates.md) | Which gates exist, which actually run, what blocks what |
| [process/release-verification.md](process/release-verification.md) | The live release gate and sign-off record |

> **Two facts that govern everything in this section:** the `testnet` release branch has
> **no CI**, and **eleven validation gates exist but are wired into no workflow.**

---

## Feature documentation

| Document | Purpose |
|---|---|
| [pod-export-restore-analysis.md](pod-export-restore-analysis.md) | Pod portability: export and restore |
| [data-backpack-docustream-foundation-runbook.md](data-backpack-docustream-foundation-runbook.md) | Data Backpack and DocuStream foundations |
| [data-backpack-docustream-implementation-status.md](data-backpack-docustream-implementation-status.md) | DocuStream implementation status |
| [CSS-Refactor.md](CSS-Refactor.md) | Design rationale for the internal-auth / Pod-proxy model |
| [solid-idp-theme-consistency.md](solid-idp-theme-consistency.md) | Solid server theming and image pinning |

---

## Staging operations

| Document | Purpose |
|---|---|
| [staging-runtime-implementation-roadmap.md](staging-runtime-implementation-roadmap.md) | Live Azure resource inventory, provisioner app settings, `INF-*` backlog |
| [staging-deployment-blueprint.md](staging-deployment-blueprint.md) | DNS, Azure, and deployment design |

---

## Strategy

| Document | Purpose | Tag |
|---|---|---|
| [strategic-architecture-status-waku-pakana-solid.md](strategic-architecture-status-waku-pakana-solid.md) | Status/Logos/Waku/Pakana ecosystem strategy — **aspirational; carries a corrections banner** | **Living** |
| [feature-implementation-attribution.md](feature-implementation-attribution.md) | Upstream dependency attribution |

---

## Historical evidence — immutable

| Location | Contents |
|---|---|
| [archive/README.md](archive/README.md) | Archive manifest, banner conventions, and **known-false claims per archived document** |

Archived 2026-09-01: Milestone G/H/I evidence summaries · the Milestone Q delta release
runbook (cohort phases inoperable) · the superseded comprehensive roadmap (seven false
completions) · the 2026-08-19 featureset review · the signed 2026-07-30 UAT checklist ·
pre-staging readiness and release-requirement plans · the DocuStream weekly tracker · the
open-source readiness assessment.

> **Archived documents are never rewritten and are not operational instructions.**
> Historical evidence describes the system at its recorded date; correcting it
> retroactively would destroy provenance. New behavior receives a new evidence summary
> after exact deployment provenance and validation pass.

---

## External third-party analysis

Not NodeZero statements. Retained unedited.

| Location | Contents |
|---|---|
| `third-party-analysis/` | External architectural reviews of Status, Logos, Waku, and NodeZero |

---

## QA data

| Location | Contents |
|---|---|
| `qa/consentful-discovery-security-vectors.json` | Milestone Q security test vectors |
| `qa/pwa-support-matrix.md` | PWA install/support matrix |
| `screenshots/` | Dated onboarding and journey evidence |
