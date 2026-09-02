# WebAuthn Level 3 PRF Extension

**Status date:** 2026-09-01
**Conformance:** **Primitive only — not part of the current security model**

---

## ⚠ Implementation Status

> **This feature is not in use.** The key-derivation primitive is implemented and
> unit-tested, but there is **no passkey ceremony and no consumer**. It is dead code in
> the shipped bundle.
>
> On web, the Stellar Ed25519 secret key is stored in **plaintext `localStorage`**.
>
> Tracked as [NC-03](known-non-conformance.md). Documentation previously described this as
> a delivered "hardware vault"; that was false.

| Component | State |
|---|---|
| Capability probe (`checkWebAuthnPrfSupport`) | ✅ Implemented |
| HKDF-SHA256 → AES-GCM-256 derivation | ✅ Implemented, unit-tested |
| `WebAuthnPrfKeyProvider` | ✅ Implemented |
| `createHardwareBoundSecureStore` | ✅ Implemented |
| **Passkey registration ceremony** | ❌ Absent — `navigator.credentials.create()` appears nowhere |
| **Passkey assertion ceremony** | ❌ Absent — `navigator.credentials.get()` appears nowhere |
| **PRF extension request** (`extensions: { prf: { eval: { first } } }`) | ❌ Absent |
| **Wired into `WalletContext`** | ❌ No — constructs `EnclaveAdapter` instead |
| **Any production consumer** | ❌ None. `setPrfSecret()` is called only from a unit test |

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
5. Define the recovery path for users whose authenticator is lost — the recovery bundle
   must remain usable.
6. Add UAT rows and device-matrix coverage.

Until then this module **SHOULD be removed from the barrel export** so it is not shipped
to users as dead code.

## 5. References

- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) · [PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension)
- [HKDF — RFC 5869](https://datatracker.ietf.org/doc/html/rfc5869)
- Implementation: [`WebAuthnPrfStore.ts`](../../packages/embedded-wallet/src/WebAuthnPrfStore.ts)
