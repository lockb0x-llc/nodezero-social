# Known Non-Conformance Register

**Status date:** 2026-09-01 · **Branch:** `testnet` @ `3cb6450`

Every gap between NodeZero's standards claims and its deployed behavior. Maintained so
that no external party can be misled by a conformance statement elsewhere in this
repository.

**Rule:** an entry is closed only when the fix is deployed and verified — not when a patch
is written.

## Status summary

| Entry | Severity | Status |
|---|---|---|
| [NC-01](#nc-01--didpkn-resolver-returned-a-constant-key-for-every-did) `did:pkn` constant key | Critical | ✅ Resolved 2026-09-01 |
| NC-02 fabricated DID metadata | Medium | Open |
| NC-03 WebAuthn PRF unused; key in plaintext | High | Open |
| NC-04 ZK verification off-chain | Medium | Open (documented) |
| NC-05 AS2 is a relationship subset | Medium | Open (by design) |
| NC-06 mainnet placeholders | High | ⚠️ Hazard removed; no deployment exists |
| NC-07 no Verifiable Credentials | Medium | Open (claim hygiene) |
| NC-08 Codex fabricated CIDs | Low | Open |
| NC-09 LDN egress SSRF untested | Medium | Open |
| NC-10 no runtime kill-switch | Medium | ✅ Resolved 2026-09-01 |

> Fixes landed on `testnet` @ working tree 2026-09-01 and are **verified locally**
> (211/211 provisioner tests, full workspace suite, 7/7 policy and QA gates). They are
> **not yet deployed** — deployed verification is required before any is cited as release
> evidence.

| Severity | Meaning |
|---|---|
| **Critical** | Exploitable, or actively misleading to integrators. Blocks publication |
| **High** | Materially weakens a security or conformance claim |
| **Medium** | Real gap; contained impact |
| **Low** | Cosmetic or documentation-only |

---

## NC-01 — `did:pkn` resolver returned a constant key for every DID

**Severity:** Critical (security) · **Status:** ✅ **Resolved 2026-09-01** · **Opened:** 2026-09-01
**Spec clause:** DID Core §7.1 (Read), §10 (Security)
**Code:** `packages/jss-provisioner/src/index.ts`, `packages/jss-provisioner/src/credentialStore.ts`

**Was:** the production resolver made no lookup against real identity state. It searched the
in-memory Community Directory projection and otherwise synthesised a record for **any**
56-character string, returning a **hard-coded literal public key** that was also the
unit-test fixture. Every `did:pkn` document carried the same
`Ed25519VerificationKey2020`, so a relying party using `did:pkn` for `authentication`
would have accepted one key holder's signatures for **every** identity.

**Fixed by:**

1. A new `lockb0x contract ID → WebID` secondary index in the credential store
   (`lockboxContractRowKey`, `findByLockboxContractId`), so a DID resolves to its **real
   owner record and per-identity Stellar public key**. A stale index row pointing at a
   reassigned contract is rejected.
2. **Existence is required.** An unknown contract returns `notFound`; the
   "any 56-character string" branch and the hard-coded key are gone.
3. **Network isolation.** The DID's network segment must match the deployment profile, so
   a `mainnet` identifier cannot resolve against testnet state.
4. **Fail-closed exposure.** The endpoint is disabled unless
   `JSS_DID_RESOLVER_ENABLED=true`.

**Regression tests** (`packages/jss-provisioner/src/index.did.test.ts`): subject-specific
key material, unknown contract → 404, cross-network → 404, disabled → 404.

**Remaining work (tracked, not blocking):** resolution is bound to the provisioner's
credential store rather than read directly from the Soroban contract. That is a
provisioner-trusted binding with the same trust boundary as [NC-04](#nc-04--zk-proof-verification-is-off-chain-and-provisioner-trusted).
True on-chain resolution via `getLedgerEntries` remains required before registry
submission. See [`did-pkn-method.md`](did-pkn-method.md) §7.

---

## NC-02 — `did:pkn` document metadata is fabricated

**Severity:** Medium · **Status:** Open
**Spec clause:** DID Core §7.1.3
**Code:** `DidPknResolver.ts`

`created` and `updated` default to `new Date().toISOString()` — resolution time, not
ledger time. Two resolutions of the same DID return different `created` values.
`deactivated` is always `false` and the deactivation path is unreachable, so a deactivated
DID cannot be represented.

**Remediation.** Source both timestamps from ledger data; implement deactivation per DID
Core (`didDocument: null` + `deactivated: true`).

---

## NC-03 — WebAuthn PRF is implemented but unused; web wallet key is in plaintext

**Severity:** High (security) · **Status:** Open
**Code:** `packages/embedded-wallet/src/WebAuthnPrfStore.ts`,
`packages/mobile-app/src/contexts/WalletContext.tsx`

The HKDF-SHA256 → AES-GCM-256 derivation is cryptographically sound and unit-tested, but
**no passkey ceremony exists** — `navigator.credentials.create()` / `.get()` appear nowhere
in the codebase. `setPrfSecret()` is called only from a unit test. `WalletContext`
constructs `EnclaveAdapter`, never `createHardwareBoundSecureStore`. On web that resolves
to `WebLocalStorageSecureStore`.

**Impact.** On `staging.nodezero.social` the **Stellar Ed25519 secret key is stored in
plaintext `localStorage`** — XSS-readable, no hardware binding, no encryption at rest —
while documentation described a "hardware vault". The PRF module is dead code shipped in
the user bundle via a barrel re-export.

**Not affected:** on-chain Ed25519 signing and the ZK Poseidon commitment are unchanged.
The PRF key was only ever a wrapping KEK.

**Remediation.** Implement the ceremony and wire it into `WalletContext`, or remove the
export and correct all documentation.

---

## NC-04 — ZK proof verification is off-chain and provisioner-trusted

**Severity:** Medium (architecture disclosure) · **Status:** Open — documentation fix required
**Code:** `packages/jss-provisioner/src/bridgeProofVerifier.ts`

Groth16 verification is performed **off-chain** by the provisioner using snarkjs, with the
verification key fetched over HTTP under a SHA-256 digest pin (good practice). The chain
stores only a `ProofHash`; it does **not** verify the proof.

**Impact.** The provisioner is a fully trusted verifier. A compromised provisioner could
anchor a `ProofHash` for an unverified proof and the on-chain 9-field audit would still
pass — it checks for nonzero 32-byte values, not proof validity.

This is a legitimate architecture. The defect is that documentation described it as
"on-chain pre-flight checks". See [zk-attestation.md](zk-attestation.md).

---

## NC-05 — ActivityStreams support is a relationship-vocabulary subset

**Severity:** Medium (scope clarity) · **Status:** Open — by design, must stay disclosed
**Code:** `packages/solid-pod-sync/src/adapters/ActivityStreamsRelationshipAdapter.ts`

NodeZero implements LDN plus an AS2 subset covering `Follow`, `Accept`, `Reject`, and
correlated `Undo`. It does **not** implement ActivityPub: no actor documents, no
WebFinger, no shared inboxes, no server-to-server federation.

**Remediation.** None required. Must never be described as ActivityPub federation.

---

## NC-06 — `did:pkn` `mainnet` is parseable but no mainnet deployment exists

**Severity:** High · **Status:** ⚠️ **Partially resolved 2026-09-01** — hazard removed, deployment still absent
**Artifacts:** `deployments/stellar-mainnet.contracts.json`,
`infrastructure/azure/main.parameters.production-mainnet.json`

**Was:** the mainnet manifest declared `"strictMainnetMode": true` and contained four
**invalid hand-typed placeholder contract IDs** of 62–63 characters (valid Stellar
contract strkeys are exactly 56). The same placeholders were wired into production Bicep
parameters, so a real run would have provisioned production against nonexistent contracts.

**Fixed by:**

1. Placeholder IDs replaced with `null` (manifest) and `""` (Bicep parameters), with
   `deploymentMode: "not-deployed"` and an explicit in-file warning.
2. `scripts/policy/validate-env-isolation.sh` now enforces **contract manifest integrity**:
   every recorded contract ID must match a valid strkey (`^C[A-Z2-7]{55}$` — note base32
   excludes `0`, `1`, `8`, `9`), and no TestNet ID may appear in a mainnet artifact.
   Verified by negative test: reintroducing the old placeholder now fails the gate.

**Still true:** there is **no mainnet deployment**. Contracts, treasury keys, and a
functional production release path remain outstanding — see [`../roadmap.md`](../roadmap.md)
Phase E.

---

## NC-07 — W3C Verifiable Credentials are not implemented

**Severity:** Medium (claim hygiene) · **Status:** Open

No `VerifiableCredential` type, no `credentials/v1` context, and no issuance or
verification path exists anywhere in `packages/**/src/**`. Adjacent strategy documents
have implied VC capability.

**Remediation.** Never claim VC support until implemented.

---

## NC-08 — Codex adapter emits fabricated identifiers, not CIDs

**Severity:** Low · **Status:** Open
**Code:** `packages/solid-pod-sync/src/adapters/CodexStorageAdapter.ts`

Identifiers are built as `` `zdn${sha256Hex.slice(0, 48)}` `` — a literal `zdn` prefix
glued to the first 24 bytes of a SHA-256 hex string. This is not a multihash, not CIDv0 or
CIDv1, not multibase, and truncates the digest to 96 bits. It can never match a CID
computed by a real Codex node for the same bytes. `useLocalFallback` defaults to `true`, so
default construction never contacts a network. There are **zero consumers**.

The same pattern applies to the Status Network L2 adapter: zero consumers, no deployed
escrow address.

**Remediation.** Implement real multihash CIDs and integrate against an actual node, or
mark both explicitly as design spikes and stop reporting them as delivered.

---

## NC-09 — LDN outbound delivery has no SSRF-resistance test coverage

**Severity:** Medium (security) · **Status:** Open
**Code:** `packages/solid-pod-sync/src/OutboxDeliveryWorker.ts`

Credential-free, SSRF-resistant external delivery is a named hard rule in the workspace
instructions. The worker has 7 unit tests, **none** asserting SSRF resistance or that
NodeZero bearer credentials are never forwarded to an external origin.

**Remediation.** Add explicit vectors (embedded private IPv4/IPv6, redirect-to-internal,
DNS rebinding, credential leakage) and wire them into the consent policy gate.

---

## NC-10 — No runtime kill-switch for consentful-discovery features

**Severity:** Medium (operational) · **Status:** ✅ **Resolved 2026-09-01**
**Code:** `packages/jss-provisioner/src/milestoneQControls.ts`

**Was:** `isEnabled()` returned `Boolean(webId)` unconditionally. Cohort gating was removed
in commit `ac17e35`, which re-committed a change that `7973189` had reverted as a *policy
violation*, with no superseding ADR. If a discovery, relationship, or transport
vulnerability were found, the only remediation was a code change plus full redeploy.

**Fixed by:** a per-feature runtime kill-switch. `JSS_Q_DISABLED_FEATURES` accepts a
comma-separated list of `directory`, `peer-profile`, `relationship`, `transport`. A
disabled feature reports `isEnabled() === false` for every WebID, is excluded from
`availability()` and `flags()`, and logs a startup warning. Unknown names are ignored
rather than failing startup. Regression tests cover the disable path and list parsing.

The misleading `cohort-denied` telemetry outcome — unreachable since cohort removal and
implying a control that no longer existed — is now `feature-disabled`, which the
kill-switch genuinely produces.

**Not affected:** authentication, per-user consent (directory participation still requires
explicit publication), block precedence, and rate limiting were always intact. Cohort
gating was an operator rollout control, not the user consent control.

**Remaining work:** the rollback workflow's "dark state" assertions still presume the old
flag model and have not been rehearsed — see [`../roadmap.md`](../roadmap.md) item B4. The
missing ADR for the gating removal is item B7.
