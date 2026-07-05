# NodeZero Social

**Decentralized · Private · Yours.**

NodeZero Social is a decentralized social platform where users own every byte of their
identity and content. It combines three open protocols into one coherent identity stack:

- **Solid Pods** — user-controlled Pod for profile, posts, and social graph, served by the Node Zero Community Server at `solid.nodezero.social` in staging.
- **Stellar Soroban smart contracts** — on-chain identity anchor, per-user `Lockb0x`, and
  factory provisioning (Stellar TestNet).
- **Groth16 zero-knowledge proofs** — browser-generated `pod_ownership` proof binding a
  WebID/Pod to a Stellar account, encrypted and anchored on-chain.

The live staging environment is at **[https://staging.nodezero.social](https://staging.nodezero.social)**
(Stellar TestNet; no real assets at risk).

During active development, **`testnet` is the release branch** for staging/TestNet readiness.
The repository default branch remains **`main`** for governance and stable entrypoint workflows.

---

## Architecture

```
   User Browser (Expo web)
   ┌─────────────────────────────────────────────────────┐
   │  Embedded Wallet (Stellar keypair, localStorage)    │
   │  pod_ownership Groth16 Proof (snarkjs/WASM)         │
   │  AES-256-GCM claim encryption (Web Crypto)          │
   └─────────────┬────────────┬────────────┬─────────────┘
                 │            │            │
    Solid OIDC   │  /v1/solid │  Soroban   │  wss relay
    sign-in      │  -account  │  RPC       │  (geo-local)
                 ▼            ▼            ▼
   Node Zero Community Server (self-hosted CSS)   Provisioner (Azure App Service)
   solid.nodezero.social   ┌──────────────────────────────┐
                           │  Creates CSS account + Pod   │
                           │  Deploys per-user Lockb0x    │
                           │  Calls Lockb0x.set_attestation│
                           │  PATCHes WebID profile card  │
                           └──────────────────────────────┘
                                          │ Soroban
                                          ▼
                              Stellar TestNet contracts
                              ┌────────────────────────┐
                              │ NodeZeroIdentity        │
                              │ Lockb0x (per-user)      │
                              │   .accountCommitment    │
                              │   .attestationCiphertext│
                              │ LockboxFactory          │
                              └────────────────────────┘
```

On returning sign-in the browser derives `Poseidon(identitySecret)` from the embedded
wallet and compares it to the on-chain `accountCommitment` — fail-closed if they differ.

---

## Repository Map

| Package / Path | Purpose |
|---|---|
| `packages/mobile-app` | Expo Router app — all user-facing screens and auth flows |
| `packages/contracts` | Soroban Rust contracts: `NodeZeroIdentity`, `Lockb0x`, `LockboxFactory`, `PoHVerifier` |
| `packages/zk-crypto` | Circom circuits, Groth16 prover/verifier, attestation cipher (AES-256-GCM) |
| `packages/embedded-wallet` | Stellar keypair enclave, Soroban invocation helpers |
| `packages/solid-pod-sync` | Solid Pod read/write, `ProfileManager`, social graph |
| `packages/jss-provisioner` | Server-side account provisioner (REST API, zero runtime deps) |
| `packages/relay-service` | WebSocket signaling relay for local P2P discovery |
| `packages/p2p-comms` | Local peer messaging and signaling protocol |
| `packages/geo-discovery` | H3 geospatial discovery utilities |
| `infrastructure/azure` | Bicep templates for the staging Azure resource group |
| `scripts/azure` | Deploy, redeploy, and validation scripts for Azure |
| `scripts/stellar` | TestNet contract deploy and Treasury/Deployer key setup |
| `scripts/qa` | Smoke tests for provisioner, Soroban, Pod, and relay |
| `deployments/` | Deployed contract IDs, artifact checksums, and domain cutover state |
| `docs/` | Architecture, environment isolation, UAT checklist, roadmap |

---

## Stellar TestNet Contracts (current)

| Contract | ID |
|---|---|
| `NodeZeroIdentity` | `CCHFYOKLGVTXEYYHWEFPI22FR26VRGG2CBBUTP6XPW3ZSIWIKEVQQ44K` |
| `Lockb0x` (demo-init) | `CB36LY5WZLJNMY4DHRXQER6LU3L4E5MGFYT2XSJG7ZJZV5SIIOKODT2H` |
| `LockboxFactory` v2 | `CA5MASVC7CH646QUZM6HFC3JAYIG4TCRHJDSBDOBFP66IW7TXYYHFUVB` |

Lockb0x wasm hash (includes `set_attestation`):
`55bcb3a4c05ff935a421f10d1a72bdeb6e4573de8954e4fbd263f7ac88a8fbd9`

Source of truth: [`deployments/stellar-testnet.contracts.json`](deployments/stellar-testnet.contracts.json)

---

## Quick Start

**Prerequisites:** Node.js 20+, pnpm 11+, Stellar CLI v27, Rust (wasm32v1-none target).

```bash
# Install dependencies
corepack pnpm install

# Type-check all packages
corepack pnpm type-check

# Lint
corepack pnpm lint

# Run tests
corepack pnpm test

# Validate environment isolation policy
corepack pnpm policy:validate-env
```

To run the app locally against the staging provisioner and TestNet contracts, set the
environment variables documented in [`docs/environment-isolation-matrix.md`](docs/environment-isolation-matrix.md)
and run:

```bash
corepack pnpm --filter @nodezero/mobile-app web
```

---

## ZK Attestation Flow (implemented, live on staging)

1. **Onboarding** — the browser generates a `pod_ownership` Groth16 proof
   (`identitySecret` private, `claimHash`/`accountCommitment`/`podBinding` public),
   encrypts the canonical claim with a Stellar-derived AES-256-GCM key, and sends
   `accountCommitmentHex` + `ciphertextHex` to the provisioner.
2. **Provisioner** — creates a Solid account + Pod on the Node Zero Community Server, deploys a per-user `Lockb0x`
   via `LockboxFactory`, calls `Lockb0x.set_attestation` (stores the identity anchor
   and encrypted claim on-chain), and PATCHes `nz:` anchor triples into the WebID
   profile card.
3. **Returning sign-in** — the browser derives the device commitment
   (`Poseidon(identitySecret)`) and compares it to the on-chain `get_account_commitment`;
   mismatches are fail-closed (session refused).
4. **Recovery** — the holder re-derives the AES-256-GCM key from the Stellar secret and
   decrypts the on-chain `attestationCiphertext` to recover the canonical claim.

---

## Environment isolation

Three canonical profiles: `local`, `staging-testnet`, `production-mainnet`. The policy
script `scripts/policy/validate-env-isolation.sh` (run via `pnpm policy:validate-env`)
enforces that staging and production values never mix. See
[`docs/environment-isolation-matrix.md`](docs/environment-isolation-matrix.md).

---

## Status

| Area | Status |
|---|---|
| Solid OIDC sign-in | ✅ Live — `staging.nodezero.social` and `solid.nodezero.social` Community Server |
| Seamless "Create Your Node" | ✅ Live — Node Zero Community Server Pod + Lockb0x deployed per user |
| ZK pod_ownership proof (browser) | ✅ Live — Groth16/snarkjs, on-device |
| On-chain attestation (`set_attestation`) | ✅ Live — `accountCommitment` + `attestationCiphertext` on TestNet |
| WebID profile-card anchor (`nz:` triples) | ✅ Live |
| On-return fail-closed attestation check | ✅ Live |
| Docustream RSS sources (add/toggle/delete + ingest) | ✅ Live — Pod-backed source registry and feed ingestion |
| Local peer messaging (P2P relay) | ✅ Live — staging relay healthy |
| Feed / social graph (FOAF) | 🔶 Shell renders; real Pod-connected graph is post-MVP |
| Proof-of-Humanity (poh.circom + PoHVerifier) | ⚪ Contract deployed; not wired into onboarding yet |
| Production-mainnet deployment | ⚪ Planned; Stellar MainNet and nodezero.social domain |

---

## Deployment references

- Azure Bicep: `infrastructure/azure/main.bicep`
- Staging deploy workflow: `.github/workflows/staging-deploy.yml`
- Stellar TestNet setup runbook: `scripts/stellar/setup-treasury-deployer.sh`
- Two-account funding model (Treasury + Deployer): `packages/jss-provisioner/src/deployerTopup.ts`
- Runtime implementation roadmap: `docs/staging-runtime-implementation-roadmap.md`
- UAT checklist: `docs/staging-uat-checklist.md`
- Feature progress + upstream attribution: `docs/feature-implementation-attribution.md`

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). All PRs must pass `pnpm lint`, `pnpm type-check`,
`pnpm test`, and `pnpm policy:validate-env`. Environment isolation is a non-negotiable gate.

## License

MIT — see [`LICENSE`](LICENSE).