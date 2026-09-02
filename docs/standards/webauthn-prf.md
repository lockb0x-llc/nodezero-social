# WebAuthn Level 3 PRF Extension

**Status date:** 2026-09-02
**Conformance:** **Implemented and tested; enablement pending a product decision**

---

## ⚠ Implementation Status

> **The ceremony is implemented.** Registration requests the `prf` extension and fails
> closed if the authenticator does not report support; assertion evaluates
> `prf.eval.first` under user verification; the derived secret binds an HKDF→AES-GCM
> wrapping key for `IndexedDbSecureStore`. The silent non-PRF fallback has been removed.
>
> **It is not switched on by default.** See the enablement section below.
>
> **Correction:** earlier documentation stated the web wallet key was in plaintext
> `localStorage`. That was wrong — records are AES-GCM encrypted in IndexedDB under a
> non-extractable key. The real gap was that the wrapping key is origin-bound but not
> user-presence-bound. See [NC-03](known-non-conformance.md).

| Component | State |
|---|---|
| Capability probe (`checkWebAuthnPrfSupport`) | ✅ |
| HKDF-SHA256 → AES-GCM-256 derivation | ✅ |
| **Passkey registration** (`registerPrfPasskey`) | ✅ Implemented 2026-09-02 |
| **PRF assertion** (`assertPrfSecret`) | ✅ Implemented 2026-09-02 |
| **Fail-closed wrapping key** | ✅ Silent software fallback removed |
| **Enable / unlock lifecycle + keyring re-wrap** | ✅ `hardwareProtection.ts` |
| Settings UI to enable | ✅ Implemented 2026-09-02 |
| Unlock-on-load flow | ✅ `useHardwareProtection` + `adoptHardwareWalletStore` |
| Virtual authenticator in `qa:smoke:auth` | ✅ Journey 5, advisory |
| Enabled by default | ❌ Deliberately opt-in — see below |

### Why it is opt-in, not default

A PRF-bound store cannot be read without a user-verification gesture, so default-on would
require a biometric prompt on **every** app load. That is a product decision, not a
technical one. It also excludes browsers and authenticators without PRF, which remain a
significant share.

**Empirical note on the test harness.** The CDP virtual authenticator **accepts**
`extensions: ['prf']` but does nothing with it — verified against Chromium 149, which
returns `prf.enabled === false` and no secret. The option that actually works is
**`hasPrf: true`**, which yields a 32-byte PRF secret. Journey 5 tries `hasPrf` first and
falls back, reporting `PARTIAL` rather than passing if PRF is not evaluated.

---

## 1. Intended design

The [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) `prf` extension lets a relying
party derive a stable, high-entropy secret from an authenticator during an assertion. The
secret never leaves the authenticator's control and is unavailable without a user gesture
(biometric or PIN).

NodeZero's intent is to use this as a **Key Encryption Key (KEK)** wrapping the device
wallet secret:

```
passkey assertion
  └─ PRF output (32 bytes, authenticator-derived)
       └─ HKDF-SHA256 (domain-separated salt + info)
            └─ AES-GCM-256 wrapping key (non-extractable CryptoKey)
                 └─ encrypts the Stellar Ed25519 secret at rest in IndexedDB
```

### Why a KEK and not a signing key

**The PRF output is never used as a signing key or as a ZK commitment input.** This is a
deliberate constraint:

- The **Stellar Ed25519 keypair remains the sole signing identity** for all Soroban
  invocations and authentication challenges.
- The **Poseidon account commitment** (`keccak256(stellarKey) mod SNARK_FIELD_SIZE`)
  remains derived from the Stellar key.

So enabling PRF would change only *how the secret is protected at rest*. It would not
alter any on-chain identity, any existing attestation, or any ZK circuit input. Verified:
these invariants are intact precisely because the PRF path is inert.

## 2. What is implemented

`packages/embedded-wallet/src/WebAuthnPrfStore.ts`:

- **`checkWebAuthnPrfSupport()`** — probes via `PublicKeyCredential.getClientCapabilities()`.
  Correct and defensive.
- **`deriveKeyFromPrfSecret()`** — HKDF-SHA256 with domain-separated salt and info,
  producing a **non-extractable** AES-GCM-256 `CryptoKey`. Cryptographically sound.
- **`WebAuthnPrfKeyProvider`** — `setPrfSecret()`, `isHardwareProtected()`, `getWrappingKey()`.
- **`createHardwareBoundSecureStore()`** — wires the provider into `IndexedDbSecureStore`.

### The silent-fallback hazard

`getWrappingKey()` falls back to a generated non-PRF AES key when no PRF secret has been
set. Because nothing ever sets one, **this fallback is the only path that would ever
execute**. If the module were wired up without implementing the ceremony first, it would
report success while providing no hardware binding at all.

## 3. Actual production storage

`packages/mobile-app/src/contexts/WalletContext.tsx` constructs `EnclaveAdapter(store)`.
On web that resolves to `WebLocalStorageSecureStore` — **plaintext `localStorage`**,
XSS-readable, no encryption at rest, no hardware binding.

## 4. Remediation

1. Implement passkey registration with the `prf` extension at account creation, and
   assertion with `prf.eval.first` at unlock.
2. Feed `getClientExtensionResults().prf.results.first` into `setPrfSecret()`.
3. Replace `EnclaveAdapter` with `createHardwareBoundSecureStore` in `WalletContext` for
   web/PWA.
4. **Remove or hard-fail the silent fallback** so an unbound store cannot masquerade as
   hardware-protected.
5. Define the recovery path for users whose authenticator is lost.
   **✅ Prerequisite satisfied 2026-09-01:** the recovery bundle is now encrypted with
   AES-256-GCM under a PBKDF2-SHA256 password key (see
   [NC-03](known-non-conformance.md)). Hardware-binding the device key is only meaningful
   once the escape hatch is also protected — previously the bundle exported the raw secret
   in cleartext, so binding the key would have moved the weak link rather than removing it.
   must remain usable.
6. Add UAT rows and device-matrix coverage.

Until then this module **SHOULD be removed from the barrel export** so it is not shipped
to users as dead code.

## 5. References

- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) · [PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension)
- [HKDF — RFC 5869](https://datatracker.ietf.org/doc/html/rfc5869)
- Implementation: [`WebAuthnPrfStore.ts`](../../packages/embedded-wallet/src/WebAuthnPrfStore.ts)
