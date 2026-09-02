# NodeZero Social — Executive Summary

**Status date:** 2026-09-01
**Source branch:** `testnet` @ `3cb64503a251e4a16817d99e3bc6c0da526c138f`
**Deployed staging:** `https://staging.nodezero.social` — marker commit `3cb6450`, workflow run `33284499441`, `releaseAction: clean-deploy`, environment `staging-testnet`
**Production Mainnet:** **not deployed. No contracts, no infrastructure, no functional release path.**

Prepared by the Docs Agent from independent audits by the Audit Agent and the QA Release
Agent. Every status claim below is bound to a code path, a deployed artifact, or an
explicit "not implemented". Where earlier documents claimed completion without deployment
evidence, this document corrects them and says so.

---

## 1. What NodeZero is

A decentralized social application built on user-owned data and device-bound
cryptographic identity:

- A **Solid Pod** stores the user's profile, social graph, and content. The Pod is
  authoritative for consent, relationship, and moderation state.
- A **device-held Stellar Ed25519 keypair** is the user's only credential. There are no
  passwords and no external identity provider.
- A **per-user Soroban `lockb0x` contract** anchors an encrypted ZK ownership attestation
  on Stellar.
- An **Expo web/mobile PWA** is the product surface.

NodeZero operates the Solid server, provisioner, Pod Access Proxy, directory index, and
relay. The user controls the device key and the authoritative Pod data; the operator can
observe or alter hosted data if its infrastructure is compromised. Product claims must
retain that distinction.

---

## 2. Honest status at a glance

| Tier | State |
|---|---|
| Identity, session, Pod provisioning, ZK anchoring | **Shipping and release-gated.** Genuinely strong. |
| Solid Pod data plane (profile, DocuStream, portability) | **Shipping.** The stable foundation. |
| Directory, discovery, relationships, moderation | **Deployed to staging and unconditionally enabled**, but its consent and privacy acceptance rows have never been executed. |
| Non-local messaging, social notifications | **Partial to not implemented.** |
| `did:pkn`, WebAuthn PRF, Codex, Status L2 | **Written but not wired.** Present as exports with no production consumer. |
| Production Mainnet | **Does not exist.** |

### The single most important correction

`docs/comprehensive-concrete-roadmap.md` (now superseded by
[roadmap.md](roadmap.md)) marked seven milestones — M3.1, M3.2, M4.1, M4.2, M5.1, M5.2,
M5.3 — as 🟢 Complete. **None of them are.** The pattern was substituting "unit tests
pass" or "a policy script passes" for "deployed and verified". Specifically:

- **M5.1 "Stellar Mainnet Contracts & Treasury — Complete"** is false.
  `deployments/stellar-mainnet.contracts.json` contains **hand-typed placeholder strings**
  (`CBMAINNETIDENTITY000…`, 62–63 characters). Valid Stellar contract IDs are exactly 56
  characters. They cannot be decoded, let alone resolved. The same placeholders are wired
  into `infrastructure/azure/main.parameters.production-mainnet.json`.
- **M5.3 claimed "Executed production cutover to apex domain."** No such cutover
  occurred. There is no evidence of one anywhere in the repository.
- **M3.2 "W3C `did:pkn` Soroban Lockb0x Resolver"** generates good DID documents but has
  **zero Soroban binding** — see §5.
- **M3.1 "WebAuthn L3 PRF Passkey Hardware Vault"** has no passkey ceremony and no
  consumers; the web wallet key is in plaintext `localStorage`.

---

## 3. Featureset status matrix

Legend: 🟢 shipping and gated · 🟡 deployed but unverified · 🟠 partial · ⚪ written, not wired · 🔴 not implemented

| # | Feature | Status | Implementation | Verification reality |
|---|---|---|---|---|
| 1 | Internal Stellar authentication | 🟢 | `jss-provisioner/src/index.ts` (`/v1/auth/stellar-challenge`, `/v1/auth/stellar-token`); `mobile-app/src/auth/useStellarSignIn.ts` | `qa:smoke:auth` — **blocking, no retry**, ran on deployed SHA |
| 2 | Multi-identity account disambiguation | 🟢 | `409 account_selection_required` + internal chooser modal — see §4 | Unit-tested; **no automated E2E row** (UAT AU3b open) |
| 3 | Seamless onboarding ("Create Your Node") | 🟢 | `mobile-app/src/onboarding/seamlessSignup.ts`, `solidAccount.ts` | Covered by blocking auth gate |
| 4 | Pod provisioning + Pod Access Proxy | 🟢 | `/v1/pod-proxy/*`; CSS on Azure Container Apps | Policy-enforced; browser never contacts CSS |
| 5 | V3 lockb0x ZK attestation | 🟢 | `zk-crypto`, `lockboxFactory.ts`; circuit `pod_stellar_bridge_v3` | `qa:audit:lockbox` — 9-field exact-set audit, **blocking**. Strongest artifact in the repo |
| 6 | Profile + DocuStream Pod persistence | 🟢 | `ProfileManager.ts`, `DocustreamManager.ts` | Advisory gates only |
| 7 | Pod export / restore (portability) | 🟢 | `PodArchiveExporter.ts`, `PodArchiveRestorer.ts` | 11 unit tests; **no round-trip fidelity gate, no UAT row** |
| 8 | Relationship lifecycle (request/accept/reject/cancel/disconnect) | 🟡 | `solid-pod-sync` relationship stores; `mobile-app/src/social/*` | Unit-tested; **live behavior uncertified** |
| 9 | Community Directory | 🟡 | `communityDirectory*.ts`; `mobile-app/src/directory/*`; Azure Table backend | Deployed and **on for every authenticated session**; `qa:smoke:community-directory` exists but **is wired into no workflow** |
| 10 | Explainable recommendations | 🟡 | `directory/entryBuilder.ts` | Unit-level only |
| 11 | Trust Circle | 🟡 | `social/trustCircleStore.ts` | Unit-level only |
| 12 | Directed compose (accepted + unblocked only) | 🟡 | `social/composeRecipients.ts`, `directedCommunicationPolicy.ts` | Consent vectors are **static source greps**, not live tests |
| 13 | Moderation (mute/block/report) + block precedence | 🟡 | `moderationEvents.ts`, `personActionPolicy.ts` | Same as above |
| 14 | LDN inbox delivery + outbox worker | 🟡 | `OutboxDeliveryWorker.ts`, `relationshipDelivery.ts` | 7 unit tests; **no SSRF / credential-free egress assertion in any gate** |
| 15 | Nearby presence + ephemeral reveal | 🟠 | `geo-discovery`, `waku-comms/presence.ts` | Requires location grant; unverified live |
| 16 | Local P2P messaging (WebRTC) | 🟠 | `p2p-comms`, `relay-service` | Relay now codified in `relay-service.bicep`. **`p2p-comms` has zero tests behind an always-passing stub** |
| 17 | Waku DM / broadcast | 🟠 | `waku-comms/dm-cipher.ts`, `chat.ts` | Local broadcast works; non-local delivery unproven end-to-end |
| 18 | Social notifications | 🔴 | `notification-orchestrator` handles provisioning events only | **Not implemented.** The roadmap cited `socialNotificationHandler.ts` — **that file does not exist.** No `social.*` event producer exists |
| 19 | `did:pkn` W3C DID method | ⚪ | `DidPknResolver.ts`, `GET /v1/did/:did` | Document generation good; **resolver has no chain binding and serves a hard-coded test key** — see §5 |
| 20 | WebAuthn Level 3 PRF | ⚪ | `embedded-wallet/src/WebAuthnPrfStore.ts` | HKDF primitive sound and unit-tested; **no ceremony, zero consumers, dead code** |
| 21 | Logos Codex blob adapter | ⚪ | `adapters/CodexStorageAdapter.ts` | Stub. Fabricated truncated CIDs; defaults to in-memory; **zero consumers** |
| 22 | Status Network L2 rail | ⚪ | `embedded-wallet` Status adapter | **Zero consumers**; no deployed escrow address |
| 23 | Production Mainnet | 🔴 | Placeholder contract IDs only | **No deployment. No functional workflow.** |
| 24 | Environment isolation policy | 🟢 | `scripts/policy/validate-env-isolation.sh` | Blocking — but **does not validate mainnet manifest contents** (the blind spot that allowed #23 to be marked complete) |

---

## 4. User onboarding and multi-identity

### Purpose

The user's only credential is a device-held Stellar Ed25519 keypair. Multi-identity
support exists because one device key can legitimately map to more than one NodeZero
account (a recovered account, a second persona, a test identity), and a returning user
must be able to choose which Pod they mean — **without** falling back to a password, an
external IdP, or an OIDC redirect.

This is a correctness prerequisite for everything in §3 rows 8–14: Directory listing,
relationship state, and Trust Circle membership are all scoped to exactly one WebID. The
app must resolve to one unambiguous identity before any social action is possible.

### Flow

**New user** — `mobile-app/src/onboarding/seamlessSignup.ts`:
1. Handle/email → "Create Your Node".
2. Device generates a Stellar keypair locally.
3. Provisioner creates the Pod + WebID, deploys a per-user Soroban `lockb0x`, and anchors
   an encrypted ZK ownership proof.
4. An inline NodeZero session is issued — no redirect leg.

**Returning user** — `mobile-app/src/auth/useStellarSignIn.ts` + `jss-provisioner/src/index.ts`:
1. `POST /v1/auth/stellar-challenge` with the device public key.
2. Device signs `{ nonce, stellarPublicKey, audience }` on-device.
3. `POST /v1/auth/stellar-token`. The provisioner verifies the signature, then calls
   `credentialStore.findAllByStellarPublicKey(...)`:
   - **0 records** → `401 no_account` → user is directed to Create Your Node.
   - **1 record**, or a `webId` already supplied → proceed to session issuance.
   - **>1 record and no `webId`** → `409 account_selection_required` with the candidate
     `{ webId, podUrl }` list. The client raises `AccountSelectionRequiredError`.
4. `mobile-app/app/index.tsx` renders an **internal account chooser modal** from that
   list. No external page, no redirect.
5. The user picks an account; the client retries with the chosen `webId`. The provisioner
   matches it against the candidate set (`404 account_not_found` on mismatch) and proceeds.

### Fail-closed invariant

A session is issued only if **all four** hold: valid Stellar signature, a matching stored
credential, a successful live Solid token mint, and a successful Pod probe. Anything else
is `401`. There is no partially-authenticated state, and the rule is identical for zero,
one, or many accounts.

### Verification status

`qa:smoke:auth` is the one blocking identity gate and ran against the deployed commit.
**However**, the multi-account chooser specifically (UAT row AU3b) has unit coverage but
**no executed end-to-end evidence**. It is listed as an open verification item in
[process/release-verification.md](process/release-verification.md).

---

## 5. Directory, discovery, and inter-personal features

### Consent model

Six independent, default-off consent axes. **None grants any other:**
public listing · public indexing · nearby presence · inbound contact requests ·
local broadcast participation · notification channels.

The Pod is authoritative. The Community Directory is a rebuildable projection of
explicitly published public manifests — never relationship authority. A local **block**
overrides every path: Solid, LDN, Waku, WebRTC, relay, compose, and rendering. Directed
communication requires an **accepted and unblocked** relationship; directory membership,
recommendations, location permission, and legacy `foaf:knows` never authorize contact.

### What is built

Substantially complete: durable Azure Table directory with ETag-fenced writes, hashed row
keys, tombstones and immediate opt-out precedence; session-authenticated manifest refresh;
independent discovery preferences with three-way cross-device merge; full ActivityStreams
`Follow`/`Accept`/`Reject`/`Undo` lifecycle with replay suppression and quarantine;
recipient-bound short-lived delivery assertions that never carry Pod credentials; lazy
`foaf:knows` → `legacy-connected` migration with accepted-only projection; and a unified
person-action surface shared by Directory, Profile, and Local.

### The verification gap — this is the real risk

Milestone Q cohort gating was **deleted** in commit `ac17e35`, removing seven script and
test files. `MilestoneQControls.isEnabled()` now returns `Boolean(webId)` — every
authenticated staging session gets every Q feature.

What that did **not** break: authentication is still enforced, per-user consent is intact
(directory participation still requires explicit publication), and the security vector
suites still run. Cohort gating was an *operator rollout* control, not the *user consent*
control.

What it did break, and what remains open:
- **No runtime kill-switch.** If a discovery vulnerability is found, the only remediation
  is a code change plus redeploy. The rollback workflow still asserts a "dark state" that
  the current deploy can no longer produce — those assertions are likely unsatisfiable.
- **All 15 Milestone Q UAT rows are `READY — NOT RUN`**, including **QA1**, the privacy
  gate asserting that private interests, Trust Circles, blocks, H3 history, reveal
  history, and message content never appear in the public index or telemetry.
- Both consent "smoke" gates are **static source-marker checks** (`readFile` only, zero
  `fetch`). Despite the name, they prove nothing about deployed behavior.

**Milestone Q is live to every staging user while its privacy acceptance criteria are
unexecuted.** That is the highest-priority item on the roadmap.

---

## 6. Standards implementation

Detailed in [standards/](standards/README.md). Summary:

| Standard | Level |
|---|---|
| Solid Protocol / WebID | Substantial, with a documented deviation (no browser Solid-OIDC; server-mediated DPoP) |
| Solid Type Indexes | Conformant (public index) |
| Linked Data Notifications | Conformant for relationship activities |
| ActivityStreams 2.0 | Profile subset — relationship vocabulary only. **Not ActivityPub federation** |
| FOAF | One-way compatibility projection |
| W3C DID Core (`did:pkn`) | **Partially conformant document generation; non-conformant resolution** |
| WebAuthn Level 3 PRF | Primitive only — not in the security model |
| W3C Verifiable Credentials | **Not implemented.** Must not be claimed |

**Publication gate:** the `did:pkn` method specification must not be submitted to any
registry or publicly promoted while the deployed resolver returns a hard-coded public key
for every identifier. See [standards/known-non-conformance.md](standards/known-non-conformance.md)
entry NC-01.

---

## 7. Top risks

> **Remediation landed 2026-09-01** (verified locally, not yet deployed): risks 1, 2, 3, 6
> and 7 below are resolved or materially reduced. Details in
> [standards/known-non-conformance.md](standards/known-non-conformance.md) and
> [process/ci-and-gates.md](process/ci-and-gates.md).

1. ~~**NC-01 — `did:pkn` resolver is an authentication-bypass primitive.**~~
   ✅ **Fixed.** Resolution now returns the subject's own key from the credential-store
   index, requires the subject to exist, enforces network isolation, and is disabled unless
   `JSS_DID_RESOLVER_ENABLED=true`. Remaining: it is provisioner-trusted, not an on-chain read.
2. ~~**Mainnet placeholders are a supply-chain hazard.**~~
   ✅ **Fixed.** IDs nulled; `policy:validate-env` now rejects any non-strkey contract ID and
   any cross-lane leak, proven by negative test.
3. ~~**The release branch has no CI.**~~
   ✅ **Fixed.** `ci.yml` now runs on `testnet`, with four previously orphaned gates wired in.
4. **Milestone Q privacy gate QA1 unexecuted while Q is fully enabled** (§5). ⬜ Still open —
   requires live staging runs.
5. **Web wallet secret in plaintext `localStorage`**, while PRF hardware binding sits unused.
   ⬜ Still open — deferred pending a recovery-path decision (NC-03).
6. ~~**Eleven gates exist and run nowhere.**~~
   ⚠️ **Reduced.** Four wired; `qa:smoke:community-directory`, `test:e2e`, `qa:matrix:two-device`,
   and the `qa:q4:*` suite remain orphaned.
7. ~~**No runtime kill-switch** (NC-10).~~
   ✅ **Fixed.** `JSS_Q_DISABLED_FEATURES` disables any Milestone Q feature at runtime.
   Rollback dark-state assertions still need repair and rehearsal.
8. **ZK verification is provisioner-trusted and off-chain.** ⬜ Open — legitimate
   architecture, now documented accurately rather than as "on-chain pre-flight checks."

---

## 8. Release posture

**Staging-testnet: operating, current, and provenance-clean.** The pipeline itself —
provenance authentication, digest-verified baselines, marker convergence, a no-retry auth
gate, 90-day retained rollback bundles — is genuinely well built.

**Production-mainnet: NO-GO.** Seven independent blockers, any one sufficient: placeholder
contracts; no functional production deployment workflow (it deploys Bicep and stops, with
a Node 22 pin against an `engines >=26.1.0` floor); soak never started; two-device matrix
is an in-process simulation wired into no workflow; rollback never rehearsed; QA1
unexecuted; and no CI on the release branch.

The path forward is sequenced in [roadmap.md](roadmap.md). It is deliberately ordered to
**verify what already exists before building anything new.**

---

## 9. Canonical references

- [Architecture](architecture.md) · [Roadmap](roadmap.md) · [System description](system-description.md)
- [Standards and conformance](standards/README.md) · [Known non-conformance](standards/known-non-conformance.md)
- [CI and gates](process/ci-and-gates.md) · [Release verification](process/release-verification.md)
- [ADR-001 Consentful discovery](adrs/consentful-discovery-communication/ADR-001-consentful-discovery-and-communication.md)
- [Environment isolation matrix](environment-isolation-matrix.md) · [Archive](archive/README.md)
