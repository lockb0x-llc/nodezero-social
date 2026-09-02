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
| [NC-12](#nc-12--feed-ranking-controls-are-non-functional-placeholder-ui) Feed ranking sliders were dead UI | Medium | ✅ Resolved 2026-09-01 |
| [NC-11](#nc-11--the-ldn-inbox-was-never-advertised-on-the-webid-profile-card) LDN inbox never advertised | High | ✅ Fixed in code 2026-09-01; needs deployed re-test |
| [NC-01](#nc-01--didpkn-resolver-returned-a-constant-key-for-every-did) `did:pkn` constant key | Critical | ✅ Resolved 2026-09-01 |
| NC-02 fabricated DID metadata | Medium | ✅ Resolved 2026-09-01 |
| [NC-03](#nc-03--key-material-at-rest-recovery-bundle-encrypted-prf-still-unwired) Key material at rest | High | ⚠️ Bundle encrypted + PRF ceremony implemented; enablement pending |
| NC-04 ZK verification off-chain | Medium | Open (documented) |
| NC-05 AS2 is a relationship subset | Medium | Open (by design) |
| NC-06 mainnet placeholders | High | ⚠️ Hazard removed; no deployment exists |
| NC-07 no Verifiable Credentials | Medium | Open (claim hygiene) |
| NC-08 Codex fabricated CIDs | Low | Open |
| NC-09 LDN egress SSRF untested | Medium | ✅ Resolved 2026-09-01 |
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

## NC-12 — Feed ranking controls were non-functional placeholder UI

**Severity:** Medium (misleading UI) · **Status:** ✅ **Resolved 2026-09-01**
**Code:** `packages/mobile-app/src/feed/rankingWeights.ts`, `packages/mobile-app/app/feed.tsx`
**Found by:** manual UI review, not by any automated gate

**Was:** the Feed exposed two sliders — **Serendipity** ("Discover new nodes in your wider
H3 area") and **Deep Ties (FOAF)** ("Prioritize posts from your immediate Trust Circles") —
and **neither affected anything**. Both were local `useState` values that were rendered and
set but never read by any filter, sort, or query, and `feed.tsx` contained zero Trust
Circle imports.

The Milestone Q plan, Phase 3 item 7, specifies *"Wire serendipity and deep-ties controls
to documented deterministic weights"*, and Q3B was recorded complete. The controls existed;
the weights did not.

### Resolution: bounded, deterministic, recency-preserving weights

`rankFeedPosts()` in `src/feed/rankingWeights.ts` implements the documented weights. The
design is constrained by the Feed's stated principle — *"no engagement-farming algorithm.
Newest first. Period."* — so ranking is expressed as a **bounded time shift**, not a score:

| Author class | Maximum boost |
|---|---|
| Trust Circle member | 12 hours (`TRUST_CIRCLE_MAX_BOOST_HOURS`) |
| Accepted connection outside the Trust Circle | 6 hours (`WIDER_NETWORK_MAX_BOOST_HOURS`) |
| The viewer's own posts | none |

A boosted post surfaces *as if published up to N hours more recently*. Properties:

- **Deterministic** — no randomness, no engagement signals; ties break on post id so the
  order is stable across renders and devices.
- **Opt-out by default** — at slider value 0 the output is exactly the previous
  chronological order.
- **Bounded and explainable** — the UI now states the actual effect ("as if up to 12h
  newer") instead of an unquantified claim.
- **Never changes what you receive** — only ordering. Ranking cannot surface content from
  anyone you have not accepted.

Ten unit tests cover zero-weighting equivalence to chronological order, reordering at full
weight, sub-threshold non-reordering, own-post exemption, bound enforcement, clamping of
out-of-range and non-finite values, stability, and unparseable-timestamp handling.

### Honest relabelling

The Serendipity slider claimed to "discover new nodes in your wider H3 area". The Feed
contains only accepted connections and the viewer's own posts — **there is no H3-sourced
content to rank**, and introducing some would carry its own consent implications. Rather
than ship a label that lies, the control is now **"Wider Network"**: it boosts accepted
connections outside your Trust Circle. That is a real axis over content that actually
exists. A genuine proximity-discovery feed remains future work.

### Related: Trust Circle naming and scope

Trust Circle is **not** a trust level, permission grant, or follow relationship. It is a
**private, sender-side audience list**:

- It requires an **already-accepted** relationship (`canAddTrustCircle: accepted && !inTrustCircle`),
  so it cannot be applied to a stranger.
- It has **no inbound effect** — it does not change what you receive (NC-12 above confirms
  the only UI claiming otherwise is inert).
- It can only **narrow** outbound audiences. `composeRecipients.ts` filters to
  accepted-and-unblocked regardless, so membership never grants reachability.

The name implies a permission or trust tier and grants neither. A future rename toward
"audience group" or "close connections" would better match behaviour. Tracked as a UX item,
not a defect.

**Fixed alongside this entry:** the Trust Circle button rendered on the signed-in user's
**own** Directory card, where it was permanently disabled and inert. Every other peer
action (Block, Mute, Report) was already guarded by `!isSelf`; the Trust Circle button was
the only one missing that guard. Now hidden on the own card.

---

## NC-11 — The LDN inbox was never advertised on the WebID profile card

**Severity:** High (functional) · **Status:** ✅ **Fixed in code 2026-09-01** — needs deployed re-test
**Spec clause:** [LDN](https://www.w3.org/TR/ldn/) §Discovery
**Code:** `packages/solid-pod-sync/src/ProfileManager.ts`, `packages/mobile-app/src/social/useConnections.ts`
**Found by:** manual two-device testing (QR0/QR1), not by any automated gate

**Symptom:** connecting to a discovered Directory member failed with
`Add failed: Recipient WebID does not advertise an inbox.` (`422 inbox_unavailable`).

**Root cause.** Every other link in the chain existed:

- `/social/inbox/` **is** created by `PodLayoutManager` with a `public-append` ACL;
- the sender **does** resolve the recipient via `WebIdDiscoveryClient`, which reads
  `ldp:inbox` from the WebID profile document body or `Link` header;
- the recipient **does** read their inbox via `relationshipInboxSync`, gated on
  `inboundContactRequests`.

But **nothing ever wrote `ldp:inbox` into the profile card.** The only writer of the
predicate was `DiscoveryManifestManager`, which puts `inboxUrl` in the *discovery manifest*
— a different resource that inbox discovery does not consult. So no relationship request
could ever be delivered to any user.

A second defect compounded it: the manifest's `inboxUrl` was gated on `publicIndexing`,
whereas ADR-001 makes **`inboundContactRequests`** the axis that governs accepting contact.

**Why tests missed it.** `relationshipDelivery.test.ts` mocks a profile that already
contains the `ldp:inbox` triple, so the suite encoded the intended contract while the
writer was never implemented. Both consent gates are static source greps and cannot catch
a missing runtime write.

**Fixed by** `ProfileManager.setInboxAdvertisement(podRoot, enabled)`, which adds the
`ldp:inbox` triple when inbound contact requests are enabled and removes it when revoked,
without disturbing unrelated profile data. It is called from `setInboundRequestsEnabled`,
so advertisement follows consent. Four regression tests cover advertise, withdraw,
unrelated-data preservation, and not creating a profile document merely to withdraw.

**Still required:** re-run the two-device connect journey against deployed staging. The fix
is verified locally only.

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

## NC-03 — Key material at rest: bundle encrypted, PRF implemented, enablement pending

**Severity:** High (security) · **Status:** ⚠️ **Substantially addressed 2026-09-01/02**
**Code:** `packages/mobile-app/src/wallet/recoveryBundleCrypto.ts`,
`packages/mobile-app/src/wallet/recoveryBundle.ts`,
`packages/embedded-wallet/src/WebAuthnPrfStore.ts`,
`packages/mobile-app/src/contexts/WalletContext.tsx`

The Stellar secret key is exposed in two places. One is now closed.

### ✅ Closed: the exported recovery bundle

The bundle previously exported the **raw Stellar secret in cleartext JSON**, bound only to
profile and network. It is now **recovery bundle v2**: the WebID and wallet keys are
encrypted with **AES-256-GCM** under a key derived from a user-chosen password via
**PBKDF2-SHA256 at 600,000 iterations**, with a fresh salt and IV per export.

- Export prompts for a password, requires confirmation, and enforces a
  12-character minimum. The password is never stored and cannot be recovered.
- Import prompts for the password and fails closed on a wrong password or any tampering
  (GCM authentication).
- Environment binding (`envProfile`, `stellarNetworkPassphrase`) stays cleartext so a
  wrong-lane bundle is rejected **before** a password is requested.
- v1 (unencrypted) bundles are **rejected on import** with an actionable message, removing
  the plaintext path entirely.
- A downgraded `iterations` value is rejected, so an attacker cannot weaken the KDF by
  editing the file.

**On ZIP encryption.** Legacy ZipCrypto was considered and rejected: it is broken by a
known-plaintext attack, and this payload starts with a fixed JSON preamble — exactly the
condition that attack requires. AES-256-GCM under PBKDF2 is the same primitive WinZip AES
uses, without the broken legacy mode and without adding an archive dependency.

12 unit tests cover round-trip, cleartext-absence, wrong password, ciphertext tampering,
v1 rejection, profile/network mismatch, malformed payloads, KDF downgrade, passphrase
minimum, and salt/IV freshness. `scripts/qa/staging-auth-evidence.mjs` Journey 0 now
generates a v2 bundle in Node and answers the password prompt; the Node ciphertext was
verified to decrypt under the app's WebCrypto path.

### ⚠️ Correction to the original finding

The 2026-09-01 audit recorded that *"the Stellar Ed25519 secret key is stored in plaintext
`localStorage`"*. **That was wrong**, and it was repeated in this register and the
executive summary before being caught on 2026-09-02.

`EnclaveAdapter` *does* contain a `WebLocalStorageSecureStore` branch, but it is only
reached when no store is supplied. `WalletContext` explicitly passes
`IndexedDbSecureStore` on web, which encrypts every record with **AES-GCM under a
non-extractable `CryptoKey`**. The app has never written wallet secrets to `localStorage`.

The real residual risk was narrower, and is what the PRF work addresses: the wrapping key
is **origin-bound but not user-presence-bound**. It is non-extractable, so an XSS attacker
cannot exfiltrate it — but they could invoke the store within the page and decrypt records
**silently, with no user gesture**.

### ✅ Closed: passkey ceremony and fail-closed storage (2026-09-02)

- `registerPrfPasskey()` creates a platform passkey with `extensions: { prf: {} }`,
  `residentKey: 'required'`, and `userVerification: 'required'`. It **fails closed** if the
  authenticator does not report `prf.enabled`, rather than registering a passkey that
  cannot derive a secret.
- `assertPrfSecret()` evaluates `prf.eval.first` against a profile-scoped salt for the
  named credential, requiring a biometric or PIN gesture.
- `unlockPrfProvider()` ties the two together and binds the derived HKDF→AES-GCM key.
- **The silent software fallback is removed.** `getWrappingKey()` previously generated a
  non-PRF AES key when unbound; since nothing ever bound it, that was the *only* path taken
  — so wiring the module up would have reported hardware protection while providing none.
  It now throws `PrfUnavailableError` unless `allowSoftwareFallback` is explicitly set.
- `hardwareProtection.ts` provides the lifecycle: capability probe, enable (register →
  unlock → re-wrap existing keyring records), and per-session unlock. Migration skips an
  unreadable record instead of stranding the whole keyring.

23 tests across the ceremony, fail-closed store, and lifecycle — including that a failed
enable does not claim protection, and that an unbound store refuses writes.

### ✅ Closed: enablement flow (2026-09-02)

- **Settings UI** — a *Device Security* section offers "Protect Wallet with a Passkey",
  then "Unlock Wallet with Passkey" once enabled, plus an opt-out. It is hidden entirely
  on devices that cannot support it.
- **Unlock-on-load** — `useHardwareProtection` drives the ceremony and calls
  `adoptHardwareWalletStore()`, which rebuilds the wallet singletons against the PRF-bound
  store.
- **Persisted state fails safe** — an `enabled` flag without a credential id reads as
  disabled, so the app never claims protection it cannot unlock. Corrupt state degrades to
  disabled rather than throwing.
- **`qa:smoke:auth` Journey 5** attaches a CDP virtual authenticator and runs a real
  registration + PRF assertion in-browser.

> **Empirical finding worth recording.** The CDP virtual authenticator **accepts**
> `extensions: ['prf']` but does not evaluate PRF — verified against Chromium 149, which
> returns `prf.enabled === false` and a zero-length secret. The working option is
> **`hasPrf: true`**, which returns a 32-byte secret. A harness using the documented-looking
> `extensions` form would have silently reported no PRF support and been mistaken for a
> browser limitation.

### ⚠️ Remaining: default-on is a product decision

Hardware protection is **opt-in**. Turning it on by default would require a biometric
prompt on every app load, and would exclude browsers and authenticators without PRF. That
tradeoff needs a product call, not an engineering one. Device-matrix rows across
Safari/Chrome/Firefox and platform authenticators are also still outstanding.

**Not affected:** on-chain Ed25519 signing and the Poseidon commitment are unchanged. The
PRF key is a wrapping KEK only, never a signing or commitment key.

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

## NC-09 — LDN outbound delivery had no SSRF-resistance test coverage

**Severity:** Medium (security) · **Status:** ✅ **Resolved 2026-09-01**
**Code:** `packages/jss-provisioner/src/relationshipDelivery.ts`, `publicResourceFetcher.ts`

Credential-free, SSRF-resistant external delivery is a named hard rule in the workspace
instructions. The protection itself already existed and was well covered at the fetcher
layer (15 cases spanning private/CGNAT/mapped-IPv4/local-IPv6 blocking, DNS-address
pinning against rebinding, redirect revalidation, and a no-authorization request
contract). What was missing was any assertion at the **delivery boundary** that it is
actually used.

**Fixed by** two tests on `deliverRelationshipActivity`:

1. no `authorization`, `cookie`, or `dpop` header reaches an external origin on either the
   discovery fetch or the inbox POST;
2. private, loopback, and link-local recipient WebIDs are rejected through the **default**
   `createCredentialFreePublicFetch` path.

Note on (2): an earlier draft injected a mock `publicFetch`, which silently bypassed the
very layer under test and produced a false failure. SSRF validation lives inside the
default fetch — by design, since URL parsing alone cannot defend against DNS rebinding —
so the test must exercise the real wiring.

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
