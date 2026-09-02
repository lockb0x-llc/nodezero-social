# NodeZero Social — Roadmap

**Status date:** 2026-09-01
**Source branch:** `testnet` @ `3cb6450` · **Deployed staging:** run `33284499441`
**Supersedes:** `docs/comprehensive-concrete-roadmap.md` and
[`docs/archive/2026-milestone-q-cohort/featureset-status-and-roadmap-review.md`](archive/2026-milestone-q-cohort/featureset-status-and-roadmap-review.md)

---

## 0. Status correction notice

The previous roadmap marked seven milestones 🟢 Complete on 2026-08-27: M3.1, M3.2, M4.1,
M4.2, M5.1, M5.2, M5.3. **An independent audit found none of them complete.** The
acceptance criteria used were "unit tests pass" or "a policy script passes" — none of
which involve a deployment, a transaction hash, an Azure resource, or a DNS cutover.

This roadmap restates those milestones at their verified status. The completion-criteria
rule below exists so it cannot recur.

### Completion criteria (binding)

A milestone may be marked **Complete** only with **all** of:

1. Code merged to `testnet` and passing CI **on that branch**.
2. A **runtime consumer** — an exported module with zero callers is not a feature.
3. Deployed provenance: a successful workflow run whose commit matches the live marker.
4. **Executed** acceptance evidence — a gate wired into a workflow, or a signed UAT row
   against the deployed commit. Not "a script exists that could test this."
5. For on-chain work: a real contract ID and transaction hash.

Anything short of this is **Implemented (unverified)**, **Written, not wired**, or
**Not started**.

---

## 1. Current status

| Phase | Milestone | Claimed | **Verified** | Evidence |
|---|---|---|---|---|
| 1 | M1.1 Remote LDN outbox delivery | 🟢 Complete | 🟡 **Implemented, unverified** | `OutboxDeliveryWorker.ts` + 7 unit tests. No live delivery proof; no SSRF/credential-free egress assertion in any gate |
| 1 | M1.2 Waku store sync on reconnect | 🟢 Complete | 🟡 **Implemented, unverified** | Unit-level only |
| 1 | M1.3 In-app social notifications | 🟢 Complete | 🔴 **Not implemented** | Cited `notification-orchestrator/src/socialNotificationHandler.ts` — **file does not exist**. No `social.*` event producer anywhere |
| 3 | Q plan Phase 3.7 serendipity / deep-ties weights | 🟢 Complete (Q3B) | 🔴 **Not implemented** | Sliders render and set state but feed no ranking logic; `feed.tsx` imports no Trust Circle data. See [NC-12](standards/known-non-conformance.md) |
| 2 | M2.1 Relay codified in Bicep IaC | 🟢 Complete | 🟢 **Complete** | `infrastructure/azure/relay-service.bicep` + parameters exist and are real |
| 2 | M2.2 Two-device zero-retry matrix | 🟢 Complete | 🔴 **Not started as specified** | `two-device-e2e-matrix.mjs` is an **in-process logic simulation** with `Keypair.random()` — no browser, no device, no network. Wired into no workflow |
| 2 | M2.3 Staging soak & performance audit | 🟡 In progress | 🔴 **Not started** | No soak tooling, no workflow, no evidence artifact |
| 3 | M3.1 WebAuthn L3 PRF hardware vault | 🟢 Complete | ⚪ **Written, not wired** | HKDF primitive sound + 5 unit tests. **No passkey ceremony** (`navigator.credentials` never called), zero consumers. Web key remains in plaintext `localStorage` |
| 3 | M3.2 `did:pkn` Soroban resolver | 🟢 Complete | ⚠️ **Partially — hazard fixed 2026-09-01** | Constant-key authentication bypass removed: real per-identity keys, existence checks, network isolation, disabled by default. Still provisioner-trusted rather than an on-chain read |
| 4 | M4.1 Logos Codex blob adapter | 🟢 Complete | ⚪ **Stub** | Fabricated truncated CIDs (`zdn` + 24 bytes of SHA-256), defaults to in-memory, zero consumers |
| 4 | M4.2 Status Network L2 rail | 🟢 Complete | ⚪ **Stub** | Zero consumers; no deployed escrow address |
| 5 | M5.1 Mainnet contracts & treasury | 🟢 Complete | 🔴 **Not started** | Placeholder IDs (62–63 chars; valid = 56). No mainnet treasury script exists |
| 5 | M5.2 Production Azure pipeline | 🟢 Complete | 🟠 **Authored, never executed** | `production-deploy.yml` exists only on `testnet` but requires `main` — structurally impossible to run |
| 5 | M5.3 Security audit & apex launch | 🟢 Complete | 🔴 **Not started** | "Executed production cutover to apex domain" is **false** |

---

## 2. Sequenced plan

Ordered so that **nothing new is built before what exists is verified**. Phases A and B
are prerequisites for any production conversation.

### Phase A — Restore verification integrity

Nothing downstream is trustworthy until these land. No new features in this phase.

**Status: complete locally 2026-09-01** (verified, not yet deployed).

| # | Work | Why | Status |
|---|---|---|---|
| A1 | Add `testnet` to `ci.yml` triggers | The release branch had **no CI**. Lint, type-check, unit and contract tests never ran for the deployed SHA | ✅ Done |
| A2 | Wire the orphan gates: `policy:validate-pwa`, `policy:validate-attestation-fail-closed`, `policy:validate-consentful-discovery` | Gates existed and ran nowhere, including the strongest structural invariant set | ✅ Done — wired into CI |
| A3 | Wire `qa:validate:production-audit` | The dependency CVE gate named for production did not run | ✅ Done — surfaced 2 real high advisories in `browserslist`, fixed via `4.28.7` override |
| A5 | Extend `validate-env-isolation.sh` to validate **mainnet manifest contents** | The blind spot that let placeholder IDs be marked "Complete" | ✅ Done — strkey validation + cross-lane leak check, proven by negative test |
| A4 | Replace the static consent "smoke" gates with live assertions | `policy:validate-consentful-discovery` and `qa:smoke:consentful-discovery` are `readFile`-only greps; they prove nothing about deployed behavior | ⬜ Open |
| A6 | Add tests for `packages/p2p-comms` | ✅ **Done 2026-09-01** — always-passing `echo` stub replaced with `tsx --test`; 7 `SignalRelay` tests covering auth-challenge signing, fail-closed on signing failure, sender-spoofing rejection, send-before-connect, malformed frames, and connect-only-after-ack |
| A7 | Wire remaining orphans: `qa:smoke:community-directory`, `test:e2e`, `qa:matrix:two-device` | Cited as evidence, run nowhere | ⬜ Open |

### Phase B — Certify Milestone Q (highest product priority)

Milestone Q is **live to every authenticated staging user** while its consent and privacy
acceptance rows have never been executed. Close that gap before anything else ships.

| # | Work | Done when |
|---|---|---|
| B1 | Execute **QA1** — the privacy gate: no private interests, Trust Circles, blocks, H3/reveal history, message content, credentials, or tokens in the public index or telemetry | QA1 signed against the deployed commit |
| B2 | Execute the remaining 14 Milestone Q UAT rows (QD1–QD5, QR0–QR4, QS1, QN1, QN2, QC1) | All signed against deployed commit, zero retries |
| B3 | Restore a **runtime kill-switch** for discovery/relationship/transport | ✅ **Done 2026-09-01** — `JSS_Q_DISABLED_FEATURES` disables any of `directory`, `peer-profile`, `relationship`, `transport` at runtime |
| B4 | Repair the rollback workflow's dark-state assertions and **rehearse rollback both directions** | ⚠️ **Repair done 2026-09-01** — the `qFlags == "false"` manifest assertion made rollback unsatisfiable against every bundle the pipeline produces; now expects `true`. **Rehearsal still outstanding** |
| B5 | Build a real two-device matrix (two accounts, two physical devices, zero retries) | Replaces the in-process simulation; wired into a workflow |
| B6 | Run the 24-hour soak; record a sanitized artifact under `docs/qa/` | No severity-1/2 regression |
| B7 | Write the missing ADR for the cohort-gating removal (`ac17e35` re-committed a change `7973189` had reverted as a policy violation, with no decision record) | ADR merged |

### Phase C — Close functional gaps

| # | Work | Current state |
|---|---|---|
| C1 | Implement social notifications end-to-end — a `social.*` event producer plus orchestrator handling | Documented complete; **does not exist** |
| C2 | Prove non-local broadcast/DM recipient inbox delivery against a live external Pod | Unit-tested only |
| C3 | Add SSRF-resistance and credential-free-egress assertions for `OutboxDeliveryWorker` | ✅ **Done 2026-09-01** — delivery-boundary tests assert no `authorization`/`cookie`/`dpop` reaches an external origin, and that private/loopback/link-local recipients are rejected through the real credential-free fetch. [NC-09](standards/known-non-conformance.md) |
| C4 | Add a Pod export→restore round-trip fidelity gate and UAT row | 11 unit tests, no acceptance row |
| C5 | Add UAT rows for the five shipped features that have none: `did:pkn`, outbox worker, Codex, Pod portability, WebAuthn PRF | No acceptance coverage |
| C6 | **Re-test the two-device connect journey on deployed staging** | ⚠️ [NC-11](standards/known-non-conformance.md) fixed in code — `ldp:inbox` was never advertised on the WebID profile card, so **no relationship request could be delivered to anyone**. Found by manual QR0/QR1 testing. Existing accounts must toggle inbound requests off→on to trigger the profile-card write |
| C7 | **Decide: wire or remove the Feed ranking controls** | ✅ **Done 2026-09-01** — wired to bounded deterministic weights (Trust Circle ≤ 12h, wider network ≤ 6h, expressed as a time shift so recency is preserved and slider-zero equals chronological). Serendipity relabelled **Wider Network** because the Feed has no H3-sourced content to rank. 10 unit tests. [NC-12](standards/known-non-conformance.md) |

### Phase D — Finish or withdraw the unwired subsystems

Each is currently shipped to users as dead code in the bundle. For each: **wire it, or
remove it and document the decision.** Do not leave exports with no consumers.

| # | Subsystem | Decision required |
|---|---|---|
| D1 | **`did:pkn` resolver** | Either bind resolution to the Soroban `lockb0x` contract (real key material per identity) **or disable the public endpoint**. It must not remain live serving a constant key — see NC-01 |
| D2 | **WebAuthn PRF** | ✅ **Implemented 2026-09-02** — passkey ceremony, fail-closed wrapping key, enable/unlock lifecycle with keyring re-wrap, Settings UI, and a PRF virtual-authenticator gate (Journey 5, advisory). Recovery bundle encrypted 2026-09-01. **Remaining:** decide whether to make it default-on (requires a biometric prompt on every load) and add device-matrix rows. See [NC-03](standards/known-non-conformance.md) |
| D3 | **Logos Codex adapter** | Implement real multihash CIDs and integrate against an actual Codex node, or mark explicitly as a design spike and stop reporting it |
| D4 | **Status Network L2 rail** | Same: real deployed escrow, or explicit spike status |

### Phase E — Production Mainnet

**Not startable until A, B, and D1–D2 are closed.** This is a distinct project with its
own contracts, keys, and release process — not a configuration flip.

| # | Work |
|---|---|
| E1 | ✅ **Done 2026-09-01** — placeholder mainnet contract IDs nulled in both the manifest and production Bicep parameters; `policy:validate-env` now rejects any invalid strkey |
| E2 | Deploy real Mainnet Soroban contracts with their own treasury and deployer keys; record real IDs, wasm hashes, and transaction hashes. Never reuse Testnet IDs, passphrases, or RPC endpoints |
| E3 | Write a mainnet treasury/deployer provisioning script (none exists) and a custody runbook |
| E4 | Build a **real** production deployment workflow: app deploy, marker, smoke, auth gate, lockbox audit, retained rollback bundle. Fix the Node 22 pin against `engines >=26.1.0`. Put it on the default branch so it can actually dispatch |
| E5 | Build a production rollback workflow (`staging-rollback.yml` is staging-scoped) |
| E6 | Exercise AT5 — treasury-sponsored member funding. TestNet uses Friendbot, so this **mainnet-only path will execute for the first time in production** unless rehearsed |
| E7 | Remove the `ALLOW_NON_MAINNET=1` escape hatch in `deploy-mainnet.sh`, which lets a testnet run overwrite the production manifest |
| E8 | Re-run the full identity, Pod, and Milestone Q evidence trail against Mainnet |
| E9 | Apex DNS cutover and public launch — only after a stable soak |

---

## 3. Deferred / explicitly out of scope

- Full ActivityPub federation, WebFinger, shared inboxes, global content federation.
- AT Protocol repositories, relays, AppViews.
- W3C Verifiable Credentials (**not implemented — must not be claimed**).
- Email social notifications (requires separate consent design and security review).
- Broad feed-ranking redesign.

---

## 4. Backlog carried forward

From `staging-runtime-implementation-roadmap.md`, still open:

- **INF-09** — provisioner app settings applied ad hoc via `az webapp config appsettings set`
  rather than codified in the workflow. Ongoing config-drift risk.
- **INF-10** — alert email unset in staging parameters; no action group wired.
- **App Service plan is Basic B1** — no deployment slots. Retained-artifact rollback is an
  accepted stopgap, not a production rollback strategy. A SKU decision is required before
  Phase E.
