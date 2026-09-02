# CI, Gates, and Validation

**Status date:** 2026-09-01 · **Branch:** `testnet` @ `3cb6450`

Authoritative record of which validation gates exist, which actually run, and which
release class each one blocks.

---

## ⚠ Two findings you need before reading the tables

### 1. The release branch has no CI

`.github/workflows/ci.yml` triggers **only** on `pull_request → main` and `push → main`.
Active development and deployment happen on `testnet`.

**Consequence:** lint, type-check, workspace unit tests, ZK artifact integrity, and Rust
contract tests have **never run in CI for any commit on `testnet`** — including `ac17e35`,
which deleted seven gate and test files. `staging-deploy.yml` does not compensate: it runs
no `lint`, no `type-check`, no `test`, and no contract tests.

There is currently **no automated proof that the deployed commit type-checks or that its
unit tests pass.** Fixing this is [roadmap.md](../roadmap.md) item A1 and is the
highest-priority engineering task in the repository.

### 2. Eleven gates exist and run nowhere

The gate *inventory* substantially exceeds the gate *wiring*. Several orphans are cited in
documentation as though they were active evidence.

---

## Policy gates

| Script | Asserts | Wired? |
|---|---|---|
| `policy:validate-env` | Profile allow-list; testnet/mainnet passphrase, RPC, and contract-ID non-mixing | ✅ **Blocking** in staging deploy |
| `policy:validate-consentful-discovery` | 22 Milestone Q consent vectors | ✅ **Blocking** — but **static source greps only** |
| `policy:validate-attestation-fail-closed` | Single fail-closed client attestation path | ✅ **Blocking** |
| `policy:validate-docustream-enabled` | DocuStream flag not regressed | ✅ **Blocking** |
| `policy:validate-repository-hygiene` | No tracked file > 5 MiB; no tracked scratch/log/report artifacts | ✅ CI (`main` + `testnet`) |
| `policy:validate-pwa` | 11 structural invariant sets: PWA origin pinning, `__Host-` cookie, retired wallet-broker purge, auth-gate origin correctness, DocuStream separated from the identity gate | ✅ **CI — wired 2026-09-01** |

> `policy:validate-pwa` encodes the strongest structural invariants in the repository.
> It is now wired into CI on both `main` and `testnet`.

### `policy:validate-env` — contract manifest integrity added

The validator previously did **not** inspect the *contents* of
`deployments/stellar-mainnet.contracts.json` or `main.parameters.production-mainnet.json`.
That blind spot is why placeholder mainnet contract IDs passed validation and were then
cited as the acceptance criterion for "Mainnet Contracts — Complete."

**Fixed 2026-09-01** — check group 10 now enforces:

- every recorded contract ID matches a valid Stellar strkey (`^C[A-Z2-7]{55}$`; base32
  excludes `0`, `1`, `8`, `9`);
- no TestNet contract ID appears in any mainnet artifact.

Verified by negative test: reintroducing the original placeholder fails the gate with
`Mainnet contract manifest contains an invalid Stellar contract id`.

---

## QA gates — blocking in `staging-deploy.yml`

| Gate | Asserts |
|---|---|
| `qa:smoke` | TLS enforced; landing markers; `/feed`, `/local`, `/profile`, `/settings` reachable |
| `qa:smoke:auth` | **The identity gate.** Onboarding (Pod + WebID + lockb0x + ZK + inline session), returning one-tap Stellar sign-in, fail-closed tamper path, zero browser↔CSS request embargo. **No retry** |
| `qa:audit:lockbox` | Release-created V3 child contracts carry complete constructor-written bridge state (9-field exact-set audit) |
| `qa:smoke:consentful-discovery` | Implementation boundaries — **static, `readFile` only** |
| `pwa:validate:artifact` | Built web artifact shape |

Plus three inline shell gates: N-1 baseline authentication (deploy mode only), first-party
API TLS reachability, and deployed + public-apex marker convergence.

### Advisory (`continue-on-error: true`)

Solid CSS image digest match · `qa:smoke:docustream-pane` · `qa:smoke:mashlib-runtime` ·
`qa:smoke:mashlib-deployed`

### Orphan gates — exist, wired nowhere

| Script | Note |
|---|---|
| `qa:smoke:community-directory` | **Cited in both instruction files as acceptance evidence.** Runs nowhere |
| `qa:matrix:two-device` | An **in-process logic simulation** with `Keypair.random()` — no browser, no device, no network |
| `test:e2e` (Playwright) | `auth-invariant.spec.ts` is cited as UAT evidence for AU3/AU7 and runs in no workflow |
| `qa:smoke:solid-bootstrap` / `qa:smoke:gate` | Not wired |
| `qa:validate:provisioner-runtime` | Not wired |
| `qa:validate:relay-runtime` | Not wired |
| `qa:q4:{preflight,candidate,published,deployed}` | Four-phase release preflight; not wired |
| `qa:device:cloud` | Opt-in device job only |

### Deleted gates still referenced in older documents

Removed in `ac17e35` — **do not attempt to run these:**

```
qa:bootstrap:directory-cohort          hash-milestone-q-cohort
validate-directory-cohort-states       staging-directory-publication-evidence
```

Seven files including two test files were deleted, with **no replacement coverage added**.

---

## Test coverage

| Package | Test files | Runs in CI on `testnet`? |
|---|---|---|
| `mobile-app` | 41 | ❌ |
| `solid-pod-sync` | 37 | ❌ |
| `jss-provisioner` | 30 | ❌ |
| `waku-comms` | 6 | ❌ |
| `scripts/qa` | 6 | ❌ |
| `embedded-wallet` | 4 | ❌ |
| `zk-crypto` | 4 | ❌ |
| `notification-orchestrator` | 2 | ❌ |
| `relay-service` | 2 | ❌ |
| `geo-discovery` | 1 | ❌ |
| `css-stellar-auth` | 1 | Retired stub — never executes |
| **`p2p-comms`** | **0** | **`echo "No tests yet"` — silent pass inside `pnpm -r test`** |
| `contracts` (Rust) | 3 snapshots | ❌ |

---

## Workflows

### `staging-deploy.yml`

```
validate-dispatch (requires confirm_staging_testnet=true)
├── capture-baseline        [release_action == capture-baseline]
├── deploy-staging          [release_action ∈ {deploy, clean-deploy}]
│     install → [N-1 baseline auth (deploy only)] → 4 policy gates
│     → azure infra → domain/TLS → provisioner → relay → Expo build
│     → artifact validate → SWA publish → marker + apex convergence
│     → qa:smoke → qa:smoke:auth (BLOCKING, no retry) → qa:audit:lockbox
│     → [3 advisory proofs] → retain 90-day rollback bundle
└── certify-physical-devices [opt-in, default false]
```

`concurrency: staging-testnet-deploy`, `cancel-in-progress: false`.

> The deployed release used `releaseAction: clean-deploy`, which **skips N-1 baseline
> authentication**. There is no authenticated prior baseline to roll back to from that
> release.

### `production-deploy.yml` — scaffolding, not a release path

Guards are real (requires `main`, explicit confirmation, 40-char SHA), but:

1. `deploy-infra` runs `scripts/azure/deploy.sh` **and stops**. No app deploy, no marker,
   no smoke, no auth gate, no lockbox audit, no rollback bundle.
2. **It cannot be dispatched.** The workflow exists only on `testnet` but requires
   `main` — GitHub only exposes manual dispatch for workflows on the default branch.
3. Node pin drift: production pins `node-version: 22`; `package.json` requires
   `>=26.1.0 <27`. `pnpm install --frozen-lockfile` under Node 22 is a live failure risk
   that has never been exercised.
4. `pnpm/action-setup@v4` with no pinned `version:` (staging and CI pin `version: 11`).
5. Runs `test:device-evidence` but **not** `qa:validate:production-audit`.

No production rollback workflow exists; `staging-rollback.yml` is staging-scoped.

### `staging-rollback.yml`

Well built — 17 steps, digest-verified retained-artifact restore.

> 🔴 **It was structurally broken until 2026-09-01, and has never been rehearsed.**
>
> `staging-deploy.yml` writes `qFlags: {directory: true, peerProfile: true, relationship: true, transport: true}`
> into every retained rollback manifest. `staging-rollback.yml` asserted every
> `qFlags.*` equalled `"false"`. **No bundle the current pipeline produces could ever
> satisfy that check**, so rollback would have aborted at manifest validation — meaning
> there was no working rollback path at all.
>
> Commit `dbb5354` had updated the *health* assertions to expect `true` but missed this
> *manifest* assertion. Fixed 2026-09-01; the check now expects `true`, consistent with the
> rest of the workflow. **Still unrehearsed** — a repaired workflow is not a proven one.
> See [`../roadmap.md`](../roadmap.md) item B4.

---

## Required checks by change type

| Change scope | Run |
|---|---|
| Any code change | `pnpm lint`, `pnpm type-check`, `pnpm test` |
| Infra / env / deploy | + `pnpm policy:validate-env` |
| Contracts | + `pnpm test:contracts` |
| Discovery / social / transport | + `pnpm policy:validate-consentful-discovery`, focused package checks |
| Staging release | + `pnpm qa:smoke`, `pnpm qa:smoke:auth`, `pnpm qa:audit:lockbox`, [release-verification.md](release-verification.md) |

Keep concerns separated: `qa:smoke:auth` gates **identity only**. Application-feature
proofs (DocuStream, mashlib, directory) run separately and must never be folded into the
identity gate.
