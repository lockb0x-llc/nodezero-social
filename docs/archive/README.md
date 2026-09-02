# Documentation Archive

Archived on 2026-09-01 against branch `testnet` @ `3cb6450` (deployed staging marker
run `33284499441`).

## Rules

1. **Archived documents are never rewritten.** Historical evidence describes the system
   at its recorded date. Correcting it retroactively destroys provenance.
2. **Archived documents are not operational instructions.** Do not follow a runbook from
   this directory. Superseded plans list their known-false claims below so they cannot be
   mined as current truth.
3. Files were moved with `git mv`, so `git log --follow` reaches their full history.

## Banner conventions

- `HISTORICAL EVIDENCE` — accurate as of its stated date and commit. Immutable.
- `SUPERSEDED` — a plan or status document replaced by a current document. Retained for
  provenance only.

## Manifest

| Archived path | Original path | Type | Superseded by | Known-false claims if read as current |
|---|---|---|---|---|
| [2026-milestone-g/milestone-g-release-evidence-summary.md](2026-milestone-g/milestone-g-release-evidence-summary.md) | `docs/milestone-g-release-evidence-summary.md` | Historical evidence (2026-06-25) | — | None. Accurate for its date. |
| [2026-milestone-h/milestone-h-release-evidence-summary.md](2026-milestone-h/milestone-h-release-evidence-summary.md) | `docs/milestone-h-release-evidence-summary.md` | Historical evidence (2026-07-10) | — | None. Accurate for its date. |
| [2026-milestone-i/milestone-i-release-evidence-summary.md](2026-milestone-i/milestone-i-release-evidence-summary.md) | `docs/milestone-i-release-evidence-summary.md` | Historical evidence (2026-07-30) | — | None. Accurate for its date. Its GO decision covers `v0.2.0-testnet`, **not** the currently deployed commit. |
| [2026-milestone-q-cohort/milestone-q-delta-release-runbook.md](2026-milestone-q-cohort/milestone-q-delta-release-runbook.md) | `docs/milestone-q-delta-release-runbook.md` | Superseded plan | [../process/release-verification.md](../process/release-verification.md) | Instructs `pnpm qa:bootstrap:directory-cohort`, `hash-milestone-q-cohort`, `validate-directory-cohort-states`, `staging-directory-publication-evidence` — **all four scripts were deleted in `ac17e35`**. All cohort phases are inoperable. |
| [2026-milestone-q-cohort/featureset-status-and-roadmap-review.md](2026-milestone-q-cohort/featureset-status-and-roadmap-review.md) | `docs/featureset-status-and-roadmap-review.md` | Superseded status review (2026-08-19) | [../executive-summary.md](../executive-summary.md), [../roadmap.md](../roadmap.md) | Self-contradictory: its banner says cohort gating was removed while its body still lists `JSS_Q_COHORT_KEY` secrets and cohort bootstrap as active blockers. Predates `did:pkn`, Pod export/restore, Codex/Status adapters, and the relay IaC work. |
| [2026-pre-staging/staging-readiness-and-agent-plan.md](2026-pre-staging/staging-readiness-and-agent-plan.md) | `docs/staging-readiness-and-agent-plan.md` | Superseded plan (2026-07-06) | [../staging-deployment-blueprint.md](../staging-deployment-blueprint.md) | Predates the internal-auth cutover and all of Milestone Q. |
| [2026-pre-staging/testnet-azure-release-requirements.md](2026-pre-staging/testnet-azure-release-requirements.md) | `docs/testnet-azure-release-requirements.md` | Superseded plan (2026-07-05) | [../process/release-verification.md](../process/release-verification.md) | Release ordering predates internal auth and Milestone Q. Names the ZK circuit `pod_ownership`; the deployed circuit is `pod_stellar_bridge_v3`. |
| [2026-pre-staging/data-backpack-docustream-weekly-execution-tracker.md](2026-pre-staging/data-backpack-docustream-weekly-execution-tracker.md) | `docs/data-backpack-docustream-weekly-execution-tracker.md` | Superseded tracker (2026-07-19) | [../data-backpack-docustream-implementation-status.md](../data-backpack-docustream-implementation-status.md) | Weekly tracker, stale since July. |
| [2026-pre-staging/public-repo-readiness.md](2026-pre-staging/public-repo-readiness.md) | `docs/public-repo-readiness.md` | Superseded readiness claim (2026-07-10) | [../executive-summary.md](../executive-summary.md) | **Asserts Solid OIDC is the live sign-in path.** That path was removed by the internal-auth cutover. Also names the ZK circuit `pod_ownership`. Do not use for OSS-launch messaging. |
| [2026-uat/staging-uat-checklist-2026-07-30.md](2026-uat/staging-uat-checklist-2026-07-30.md) | `docs/staging-uat-checklist.md` | Historical signed UAT snapshot | [../process/release-verification.md](../process/release-verification.md) | Its `GO for v0.2.0-testnet` sign-off is **void as current certification** — it predates the deployed commit by 4+ releases. Contains PASS rows recorded against `solidcommunity.net` WebIDs, an identity path the current architecture forbids. Contains an instruction referencing a plaintext credential file; that instruction is not carried into the successor document. |

## Why the UAT checklist was reset rather than edited

The 2026-07-30 checklist carries a signed GO across roughly 30 rows that were executed
against earlier commits. Editing those rows in place would launder stale PASS marks into
a document presented as current certification. The signed copy is preserved here verbatim;
[../process/release-verification.md](../process/release-verification.md) re-issues the
matrix with every row unset except rows re-executed against the deployed commit.
