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
CSS (self-hosted Solid)  Provisioner (Azure App Service)
solid.nodezero.social   ┌───────────────────────────────────┐
                        │  1. Creates CSS account + Pod      │
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

## Trust boundary table

| Component | Centralized / Decentralized | Can observe |
|---|---|---|
| **Stellar Lockb0x** | Decentralized (on-chain) | `accountCommitment` (public), `attestationCiphertext` (public but encrypted), `storage_entries`, event log |
| **ZK proof** | Trustless | Prover knows `identitySecret`; verifier only sees the three public signals |
| **Device wallet** | User-controlled | Holds `stellarSecretKey`; derives `identitySecret`; generates proof and encryption key |
| **CSS Pod server** | Centralized (operator-run) | Pod content, OIDC tokens (short-lived), DPoP-bound access tokens |
| **Provisioner (Azure App Service)** | Centralized (operator-run) | CSS account creation payload, `accountCommitmentHex`, `ciphertextHex`, Stellar deploy invocations |
| **WebSocket relay** | Centralized (operator-run) | Signaling messages (offer/answer/ICE), not message content |
| **On-chain NodeZeroIdentity** | Decentralized (on-chain) | Stellar public key → WebID mapping (public) |

**On returning login the provisioner is not in the loop.** The browser derives
`Poseidon(identitySecret)` locally and compares to the on-chain
`accountCommitment`; a mismatch refuses the session without a server call.

---

## Threat model

### Compromised provisioner server

**What an attacker can do:** create CSS accounts and lockb0xes with attacker-chosen
identity commitments; overwrite the `accountCommitment` on existing lockb0xes
(if they can invoke `set_attestation` as the Deployer).

**Mitigation:** The Deployer key is held in Azure Key Vault with RBAC; the
provisioner retrieves it only at startup via managed identity. `set_attestation`
enforces `caller.require_auth()` — only the registered Deployer can call it.
Existing user data in their Solid Pod is protected by the Pod ACL; the
provisioner's DPoP credentials are short-lived and scoped to account creation.

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
| **User Stellar keypair** | `localStorage` / `expo-secure-store` | User's device only | Destroy + re-provision |
| **Deployer keypair** | Azure Key Vault (`stellar-deployer-secret`) | Provisioner (read at startup via managed identity) | `setup-treasury-deployer.sh` |
| **Treasury keypair** | Azure Key Vault (`stellar-treasury-secret`) | Provisioner (top-up only) | `setup-treasury-deployer.sh` |
| **CSS client credentials** | Provisioner (generated per account, stored in Pod) | Provisioner at creation only | Revocable per CSS account |
| **Azure Managed Identity** | Azure (RBAC-granted to App Service) | Provisioner → Key Vault reads | Azure RBAC rotation |
