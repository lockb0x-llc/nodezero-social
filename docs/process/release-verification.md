# Release Verification

**Status date:** 2026-09-01 · **Deployed staging:** `3cb6450`, run `33284499441`
**Supersedes:** [`docs/archive/2026-uat/staging-uat-checklist-2026-07-30.md`](../archive/2026-uat/staging-uat-checklist-2026-07-30.md)
and the cohort phases of the archived Milestone Q runbook

---

## Why this document resets the matrix

The previous UAT checklist carried a signed **`GO for v0.2.0-testnet` (2026-07-30)** across
roughly 30 rows, executed against a commit several releases behind what is deployed.
Editing those rows in place would launder stale PASS marks into a document presented as
current certification.

The signed copy is preserved verbatim in the archive. **This document re-issues the matrix
with every row unset except rows re-executed against the deployed commit.**

> **The 2026-07-30 sign-off is void as current certification.**

Additionally, several rows in the archived checklist recorded PASS against
`solidcommunity.net` WebIDs — an external identity path the current architecture forbids —
and one referenced a plaintext credential file. Those rows describe a retired system and
are **not** carried forward.

---

## Current certification status

| Release class | Status |
|---|---|
| `staging-testnet` | **Partially certified.** Identity gate green on the deployed commit; Milestone Q acceptance unexecuted |
| `production-mainnet` | **NO-GO.** See §5 |

---

## 1. Automated gates on the deployed commit

Executed as part of run `33284499441`.

| # | Gate | Result |
|---|---|---|
| G1 | `policy:validate-env` | ✅ PASS (blocking) |
| G2 | `policy:validate-consentful-discovery` | ✅ PASS (blocking) — ⚠️ static source check only |
| G3 | `policy:validate-attestation-fail-closed` | ✅ PASS (blocking) |
| G4 | `policy:validate-docustream-enabled` | ✅ PASS (blocking) |
| G5 | `qa:smoke` | ✅ PASS (blocking) |
| G6 | `qa:smoke:auth` | ✅ PASS (blocking, no retry) |
| G7 | `qa:audit:lockbox` | ✅ PASS (blocking) |
| G8 | `pwa:validate:artifact` | ✅ PASS (blocking) |
| G9 | Marker + apex convergence | ✅ PASS (blocking) |
| G10 | `policy:validate-pwa` | ⬜ **NOT RUN — orphan gate** |
| G11 | `qa:smoke:community-directory` | ⬜ **NOT RUN — orphan gate** |
| G12 | `test:e2e` (Playwright) | ⬜ **NOT RUN — orphan gate** |
| G13 | `lint` / `type-check` / `test` / `test:contracts` | ⬜ **NOT RUN — no CI on `testnet`** |

---

## 2. Identity and session

| # | Journey | Expected | Status |
|---|---|---|---|
| AU1 | Returning user one-tap Sign In | Stellar signature login → feed. No IdP page, no password, no redirect, zero requests to the Solid origin | ✅ Covered by G6 |
| AU2 | Sign In with no NodeZero account | Actionable `no_account` error pointing to Create Your Node | ⬜ **NOT RUN** — no automated coverage |
| AU3 | Landing page audit | No password inputs, no external IdP picker, no `solidcommunity.net` reference | ⬜ **NOT RUN** — depends on orphan gate G12 |
| **AU3b** | **Multi-account chooser** | `409 account_selection_required` → internal chooser modal → selecting a WebID signs into that exact account, no external redirect | ⬜ **NOT RUN** — unit-tested only. See [executive-summary.md §4](../executive-summary.md) |
| AU4 | Sign out | Memory and host-only browser sessions revoked; protected deep links redirect | ✅ Covered by G6 |
| AU5 | New-user onboarding | ZK proof → Pod + WebID → lockb0x anchored → inline session → feed | ✅ Covered by G6 |
| AU6 | Returning sign-in restores identity | Same WebID; lockb0x anchor metadata; client attestation verifies | ✅ Covered by G6 |
| AU7 | Fail-closed tamper path | Tampered session → sign-in page; no zombie state | ✅ Covered by G6 |
| AU10 | Unapproved origin / revoked cookie | `403` unapproved origin; `401 session_invalid` revoked | ⬜ **NOT RUN** — needs browser negative proof |

---

## 3. Milestone Q — discovery, relationships, safety

> ⚠️ **All Milestone Q features are unconditionally enabled for every authenticated
> staging session** (commit `ac17e35` removed cohort gating). **Every acceptance row below
> is unexecuted.** This is the single largest verification gap in the project.

| # | Case | Status |
|---|---|---|
| **QA1** | **Privacy gate** — no private interests, Trust Circles, blocks, H3/location history, reveal history, message content, credentials, or tokens appear in the public index, telemetry, or evidence | ⬜ **NOT RUN — highest priority** |
| QD1–QD5 | Directory: default-off listing, own-record mutation only, cross-user denial, opt-out removal latency, pagination and tombstones | ⬜ NOT RUN |
| QR0–QR4 | Relationships: request, accept, reject, cancel, disconnect — idempotent and consistent across screens | ⬜ NOT RUN |
| QS1 | Safety: block precedence across Directory, Profile, compose, LDN, Waku, relay, and rendering | ⬜ NOT RUN |
| QN1 | Nearby presence and mutual reveal | ⬜ NOT RUN |
| QN2 | Revoke discovery from a second physical device | ⬜ NOT RUN |
| QC1 | Directed communication requires accepted **and** unblocked state | ⬜ NOT RUN |
| CD1 | Directory tab present between Feed and Backpack | ⬜ NOT RUN — depends on orphan gate G11 |
| CD2 | Unlisted users absent from non-connection results | ⬜ NOT RUN |

---

## 4. Features with no acceptance coverage at all

Shipped, with zero UAT rows. Adding these is [roadmap.md](../roadmap.md) item C5.

| Feature | Coverage |
|---|---|
| `did:pkn` resolver | 10 unit tests. **No acceptance row.** Also blocked by [NC-01](../standards/known-non-conformance.md) |
| `OutboxDeliveryWorker` | 7 unit tests. **No SSRF / credential-free egress assertion** ([NC-09](../standards/known-non-conformance.md)) |
| `CodexStorageAdapter` | 6 unit tests. Stub ([NC-08](../standards/known-non-conformance.md)) |
| Pod export / restore | 11 unit tests. **No round-trip fidelity gate** |
| WebAuthn PRF | 5 unit tests. **Not wired** ([NC-03](../standards/known-non-conformance.md)) |
| Nav overflow at 375px (N1–N3) | Never executed; N3 needs Safari/WebKit, in no gate |

---

## 5. Production Mainnet — NO-GO

Seven independent blockers. Any one is sufficient.

| # | Blocker | Evidence |
|---|---|---|
| B1 | **Mainnet contracts are placeholders** | `deployments/stellar-mainnet.contracts.json` holds invalid 62–63 char strings; valid strkeys are 56. [NC-06](../standards/known-non-conformance.md) |
| B2 | **No functional production deployment path** | `production-deploy.yml` deploys Bicep and stops; cannot be dispatched (exists on `testnet`, requires `main`); Node 22 vs `engines >=26.1.0` |
| B3 | **Soak never started** | No tooling, no workflow, no artifact |
| B4 | **Two-device matrix is a simulation** | `two-device-e2e-matrix.mjs` runs in one Node process with random keypairs; wired nowhere |
| B5 | **Rollback never rehearsed** | And its dark-state assertions are likely unsatisfiable ([NC-10](../standards/known-non-conformance.md)) |
| B6 | **QA1 unexecuted while Q is fully enabled** | §3 |
| B7 | **No CI on the release branch** | [ci-and-gates.md](ci-and-gates.md) |

Additional mainnet-specific risk: **AT5** — treasury-sponsored member funding is a
MainNet-only path (TestNet uses Friendbot). It is untestable in staging and would execute
for the first time in production unless rehearsed.

---

## 6. Sign-off template

Do not sign without naming the exact commit and workflow run.

```
Release class:      staging-testnet | production-mainnet
Commit:             <40-char SHA>
Workflow run:       <run id> / attempt <n>
Live marker match:  yes | no
Blocking gates:     <list, all PASS>
Manual rows:        <ids executed, zero retries>
Open P0/P1:         <list or none>
Rollback proven:    yes | no
Soak:               <duration, regressions>

Decision:           GO | NO-GO
Project Manager:    ____________  Date: ______
QA Release Agent:   ____________  Date: ______
Audit Agent:        ____________  Date: ______
```

**A release decision requires all three signatures.** Azure endpoint availability alone is
never deployment evidence — require a successful workflow run and matching deployed
provenance.
