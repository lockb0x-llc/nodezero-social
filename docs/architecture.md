# Architecture

This document describes the NodeZero Social system architecture, component
responsibilities, trust boundaries, and threat model.

---

## System diagram

```
   User Browser (Expo web)
   ┌────────────────────────────────────────────────────────┐
   │  Embedded Wallet                                       │
   │    Stellar keypair stored in localStorage (web) or     │
   │    expo-secure-store (native). Never leaves the device. │
   │                                                        │
   │  pod_ownership Groth16 Proof (snarkjs / WASM)          │
   │    Private: identitySecret = SHA256(stellarSecret) mod F│
   │    Public:  accountCommitment = Poseidon(identitySecret)│
   │             claimHash = H(canonical Pod-ownership claim)│
   │             podBinding = Poseidon(secret, claimHash)   │
   │                                                        │
   │  AES-256-GCM Claim Encryption (Web Crypto API)         │
   │    Key = HKDF-SHA256(stellarSecret, "NZ_ATTEST_ENC_V1")│
   │    Plaintext = canonical Pod-ownership claim string    │
   │    Wire format: ver(1) || nonce(12) || ciphertext+tag  │
   └───────┬────────────┬────────────┬───────────────────────┘
           │            │            │
Solid OIDC │  /v1/solid │  Soroban   │  wss relay
sign-in    │  -account  │  RPC       │  (geo-local)
           ▼            ▼            ▼
Node Zero Community Server (self-hosted CSS)  Provisioner (Azure App Service)
solid.nodezero.social   ┌───────────────────────────────────┐
                        │  1. Creates Solid account + Pod    │
                        │  2. Deploys Lockb0x via factory    │
                        │  3. Calls Lockb0x.set_attestation  │
                        │  4. PATCHes nz: triples to card    │
                        │  (zero runtime deps — stellar CLI) │
                        └─────────────┬─────────────────────┘
                                      │ Stellar RPC
                                      ▼
                          Stellar TestNet / MainNet
                          ┌──────────────────────────────┐
                          │ NodeZeroIdentity              │
                          │   register_webid(G..., WebID) │
                          │ Lockb0x (per-user)            │
                          │   accountCommitment: bytes32  │
                          │   attestationCiphertext: bytes │
                          │ LockboxFactory                │
                          │   get_or_create_user_lockbox  │
                          │ PoHVerifier (future)          │
                          └──────────────────────────────┘
```

---

## Package responsibilities

| Package | Responsibility |
|---|---|
| `packages/mobile-app` | Expo Router UI, auth flows, wallet context, onboarding |
| `packages/contracts` | Soroban Rust contracts; built to wasm32v1-none |
| `packages/zk-crypto` | Circom circuits, snarkjs prover/verifier, attestation cipher |
| `packages/embedded-wallet` | Stellar keypair, Soroban invocation helpers |
| `packages/solid-pod-sync` | Solid Pod read/write, ProfileManager, social graph |
| `packages/jss-provisioner` | REST API provisioner; zero runtime dependencies |
| `packages/relay-service` | WebSocket signaling relay for geo-local P2P |
| `packages/p2p-comms` | WebRTC offer/answer and ICE relay protocol |
| `packages/geo-discovery` | H3 geospatial index and local-node discovery |

---

## Internal API boundaries

The provisioner is the only server-side component that holds service secrets
(CSS client credentials, Stellar CLI key aliases). It does not hold the user's
Stellar keypair — that lives exclusively on the device.

The device generates the ZK proof and the encrypted claim before calling the
provisioner. The provisioner stores the outputs on-chain; it never sees the
plaintext claim or the identitySecret.

---

## Authentication and session handoff

Identity is a standalone concern, separated from application features
(feed, docustream, backpack, etc.). Application features consume an
authenticated session; they never participate in establishing one.

### The session invariant (fail-closed)

> **Signed in ⟺ the provisioner can mint a live DPoP-bound Solid token for
> the user's Pod right now.**

- The user's only credential is the device Stellar keypair. There are no
  user-facing passwords anywhere: the CSS account password is generated
  server-side at provisioning, used once against the CSS account API, and
  discarded. No human ever knows it.
- The browser NEVER contacts the Community Server. All Pod reads/writes flow
  through the provisioner's **Pod Access Proxy** (`/v1/pod-proxy/*`), which
  exchanges the user's stored client credentials for short-lived DPoP tokens.
- A NodeZero session is only issued after the provisioner (a) minted a Solid
  token from the stored credentials AND (b) probed the Pod with it. Any
  failure ⇒ 401, no session, no degraded state.
- Every proxy request revalidates: CSS 401 → one fresh re-mint retry →
  `401 session_invalid`. The client destroys its session on
  `session_invalid` and returns to the sign-in page.
- The client is a binary state machine (`restoring | unauthenticated |
  authenticated`) with a single route guard. There is no cached-identity
  fallback and no half-authenticated state.

### New-user onboarding (seamless "Create Your Node")

1. User enters handle and notification email on the landing page.
2. Device generates the pod_ownership Groth16 proof and encrypted claim.
3. App calls provisioner `POST /v1/solid-account` (no password in the
   contract — the ephemeral CSS password is server-internal).
4. Provisioner creates the CSS account + Pod, mints + encrypts per-user
   client credentials into the credential store (Azure Table / AES-256-GCM),
   anchors the lockb0x + attestation on-chain, then **proves the session
   invariant** (token mint + Pod probe) and returns a ready NodeZero session
   inline. There is no bridge, no redirect leg, and no consent screen.
5. The app adopts the session and lands in the feed once the client-side
   on-chain attestation check verifies.

### Returning-user authentication (one-tap Stellar sign-in)

1. User clicks Sign In; app requests a challenge
   (`POST /v1/auth/stellar-challenge`) for the device public key.
2. Device signs the challenge payload locally; app exchanges it at
   `POST /v1/auth/stellar-token`.
3. Provisioner verifies the Ed25519 signature, resolves the stored
   credentials via the Stellar-key index, re-proves the session invariant,
   and returns a NodeZero session (+ lockbox anchor metadata). Unknown key
   → `401 no_account`; CSS outage → `401 session_unavailable`. No fallback.
4. Post-authentication verification is fail-closed and client-side: the
   session is only trusted after the on-chain lockb0x pairing attestation
   verifies (`attestationStatus === 'verified'`); otherwise routing forces
   `/onboarding`. **On returning login the chain check runs without the
   provisioner in the loop** — the device derives `Poseidon(identitySecret)`
   locally and compares it to the on-chain `accountCommitment`.

### Session lifecycle

- Access tokens are HMAC-signed JWTs (1h TTL); refresh tokens are opaque,
  single-use, and rotated on refresh. Refresh re-proves the invariant.
- Logout invalidates refresh tokens; operator revocation
  (`POST /v1/auth/revoke`, internal-key protected) deletes the stored
  credentials — every live and future session for that WebID then fails
  closed at the proxy, at refresh, and at login.
- Recovery = Stellar keypair recovery (export bundle / destroy +
  re-provision). There is no password reset because there are no passwords.

### Release gating

The blocking staging gate for identity is `pnpm qa:smoke:auth`
([scripts/qa/staging-auth-evidence.mjs](../scripts/qa/staging-auth-evidence.mjs)),
which exercises new-user onboarding, returning one-tap sign-in, and the
negative fail-closed path end-to-end, including on-chain evidence and a
zero-CSS-contact request embargo. It runs without retries: session issuance
is a single server round-trip with no redirect-timing window.
Application-feature proofs (docustream/mashlib) run separately and never
block identity releases.

---

## Trust boundary table

| Component | Centralized / Decentralized | Can observe |
|---|---|---|
| **Stellar Lockb0x** | Decentralized (on-chain) | `accountCommitment` (public), `attestationCiphertext` (public but encrypted), `storage_entries`, event log |
| **ZK proof** | Trustless | Prover knows `identitySecret`; verifier only sees the three public signals |
| **Device wallet** | User-controlled | Holds `stellarSecretKey`; derives `identitySecret`; generates proof and encryption key; signs login challenges |
| **Node Zero Community Server (CSS Pod server)** | Centralized (operator-run) | Pod content, DPoP-bound access tokens minted by the provisioner |
| **Provisioner (Azure App Service)** | Centralized (operator-run) | CSS account creation payload, encrypted per-user client credentials, NodeZero session issuance, every proxied Pod request, `accountCommitmentHex`, `ciphertextHex`, Stellar deploy invocations |
| **WebSocket relay** | Centralized (operator-run) | Signaling messages (offer/answer/ICE), not message content |
| **On-chain NodeZeroIdentity** | Decentralized (on-chain) | Stellar public key → WebID mapping (public) |

**On returning login the on-chain attestation check runs client-side.** The
browser derives `Poseidon(identitySecret)` locally and compares it to the
on-chain `accountCommitment`; a mismatch refuses the session even though the
provisioner already issued one — both gates must pass.

---

## Threat model

### Compromised provisioner server

**What an attacker can do:** create CSS accounts and lockb0xes with attacker-chosen
identity commitments; overwrite the `accountCommitment` on existing lockb0xes
(if they can invoke `set_attestation` as the Deployer); **read and write any
user's Pod** via the stored client credentials (the proxy is the Pod access
path); issue NodeZero sessions for arbitrary WebIDs.

**Mitigation:** The Deployer key is held in Azure Key Vault with RBAC; the
provisioner retrieves it only at startup via managed identity. `set_attestation`
enforces `caller.require_auth()` — only the registered Deployer can call it.
Per-user client credentials are AES-256-GCM encrypted at rest
(`JSS_CREDENTIALS_ENC_KEY`, Key Vault-sourced) in Azure Table Storage; every
token mint is audit-logged (`pod-token.minted`); Solid tokens are short-lived
and cache-evicted on revocation. `POST /v1/auth/revoke` (internal-key
protected) deletes a user's credentials, immediately failing every session
closed. The client-side lockb0x attestation check limits impersonation: a
provisioner-forged session cannot pass the on-chain commitment comparison
without the device's `identitySecret`.

**User action if compromised:** re-generate a fresh keypair and re-provision;
the on-chain lockb0x is per-user and can be re-anchored.

### Lost or stolen Stellar keypair

**What an attacker can do:** re-derive `identitySecret`, decrypt the on-chain
`attestationCiphertext`, impersonate the user's lockb0x identity.

**Mitigation:** The keypair is stored in `localStorage` / `expo-secure-store`,
not transmitted. Recovery relies on the Pod-side encrypted backup. Key rotation
(destroy local key → provision new keypair → re-anchor) is a planned future flow.

### Stolen encrypted attestation ciphertext

**What an attacker can do:** read the ciphertext from the chain (public), but
cannot decrypt without the Stellar secret.

**Mitigation:** AES-256-GCM with a Stellar-derived key (HKDF-SHA256). The
on-chain `accountCommitment` reveals nothing about the secret; the ciphertext
exposes nothing without it.

### Relay metadata

**What the relay can observe:** which Stellar public keys are in the same H3
cell at the same time (ephemeral signaling only; no message content).

**Mitigation:** H3 geospatial indices are coarse (hexagonal cells, not precise
GPS). The relay does not log signaling sessions. A future mitigation is to run
the relay as a community-operated node.

### Soroban contract bugs

**What an attacker can do:** exploit a contract bug to overwrite state roots or
drain Deployer/Treasury funds on TestNet.

**Mitigation:** Contracts are audited before MainNet deployment. The Deployer
holds only 50 XLM at a time (topped up per-lockb0x). Treasury keys are stored
in Key Vault, not in code. Contract upgrade requires a new wasm upload and
factory re-initialisation (explicit, not automatic).

---

## Key custody model

| Key | Stored in | Used by | Rotation |
|---|---|---|---|
| **User Stellar keypair** | `localStorage` / `expo-secure-store` | User's device only (login signatures, ZK derivation) | Destroy + re-provision |
| **Deployer keypair** | Azure Key Vault (`stellar-deployer-secret`) | Provisioner (read at startup via managed identity) | `setup-treasury-deployer.sh` |
| **Treasury keypair** | Azure Key Vault (`stellar-treasury-secret`) | Provisioner (top-up only) | `setup-treasury-deployer.sh` |
| **CSS client credentials (per user)** | Azure Table Storage, AES-256-GCM encrypted (`JSS_CREDENTIALS_ENC_KEY`) | Pod Access Proxy + session issuance | `POST /v1/auth/revoke` + re-provision |
| **NodeZero session signing key** | App Service setting (`JSS_SESSION_SIGNING_KEY`, Key Vault-sourced) | Provisioner session mint/verify | Rotate setting; all sessions re-issued on next sign-in |
| **CSS account password** | Nowhere — generated at provisioning, used once, discarded | Provisioner (account creation only) | Not applicable (no password auth surface exists) |
| **Azure Managed Identity** | Azure (RBAC-granted to App Service) | Provisioner → Key Vault reads | Azure RBAC rotation |
