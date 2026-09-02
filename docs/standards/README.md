# NodeZero Standards and Conformance

**Status date:** 2026-09-01 · **Branch:** `testnet` @ `3cb6450`

This directory documents NodeZero's implementation of open standards. It exists so that
external reviewers, integrators, and standards bodies can assess what NodeZero actually
does — including where it falls short.

## Rules for this directory

1. **Nothing enters without a code reference and a test reference.** A claim without a
   file path is not admissible here.
2. **Non-conformance is documented, not omitted.** Every partial or failed conformance
   point has an entry in [known-non-conformance.md](known-non-conformance.md).
3. **Normative language** follows RFC 2119 (MUST, SHOULD, MAY).
4. A specification document describing intended behavior MUST carry an **Implementation
   Status** section stating what is actually deployed.

## Contents

| Document | Scope |
|---|---|
| [conformance-matrix.md](conformance-matrix.md) | One row per standard: level, module, tests, caveats. **Start here.** |
| [known-non-conformance.md](known-non-conformance.md) | Dated, severity-ranked defects. **Read before citing any conformance claim.** |
| [did-pkn-method.md](did-pkn-method.md) | The `did:pkn` DID method specification |
| [solid-webid-and-type-index.md](solid-webid-and-type-index.md) | Solid Protocol, WebID, Type Index usage and deviations |
| [ldn-and-activitystreams.md](ldn-and-activitystreams.md) | LDN inbox semantics and the AS2 relationship profile |
| [webauthn-prf.md](webauthn-prf.md) | WebAuthn Level 3 PRF key-derivation design |
| [zk-attestation.md](zk-attestation.md) | Groth16/BN254 Pod-ownership attestation and its trust boundary |

## Publication gate

> ⚠️ **This directory MUST NOT be submitted to the W3C DID Specification Registries or
> promoted for third-party integration until the remaining `did:pkn` items in
> [`did-pkn-method.md`](did-pkn-method.md) §7 are closed.**
>
> [NC-01](known-non-conformance.md) — the constant-key authentication hazard — was
> **resolved on 2026-09-01**: resolution is now bound to real per-identity key material,
> requires the subject to exist, enforces network isolation, and is disabled unless
> explicitly enabled. That removes the exploit, but the method is still not registry-ready:
> resolution is provisioner-trusted rather than read from the Soroban contract, `stellarAddress`
> is an undefined JSON-LD term, and Update/Deactivate are unimplemented.
>
> Internal documentation and linking are fine. External standardization is not yet.

## What NodeZero does not implement

Stated plainly so it is never inferred:

- **W3C Verifiable Credentials** — no issuance, no verification, no `credentials/v1`
  context anywhere in the codebase.
- **ActivityPub federation** — no actor documents, no WebFinger, no shared inboxes, no
  server-to-server delivery. NodeZero uses LDN plus an AS2 vocabulary subset.
- **AT Protocol** — no repositories, relays, AppViews, or label protocol.
- **DID Core Update/Deactivate operations** — only Read is implemented.
