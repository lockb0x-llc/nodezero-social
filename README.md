# NodeZero Social

NodeZero Social is a decentralized social app that combines Solid Pods,
Stellar Soroban contracts, and zero-knowledge proofs.

For the Stellar Hacks: Real-World ZK hackathon, the current implementation
targets a simple, high-value attestation flow on Stellar TestNet:

1. Link a Solid Pod WebID to a Stellar account using `NodeZeroIdentity`.
2. Anchor an attested-set ZK root in `Lockb0x`.
3. Verify the Stellar<->Solid pairing at sign-in against the current lockbox root.

PoH-style human-uniqueness verification is planned for a future release and is
explicitly out of scope for this milestone.

## Hackathon Fit

This submission satisfies the core requirement: meaningful ZK integrated with
Stellar smart contracts.

1. On-chain identity link contract: `packages/contracts/src/lib.rs` (`NodeZeroIdentity`).
2. On-chain attestation-root anchor: `packages/contracts/src/lib.rs` (`Lockb0x`).
3. ZK artifact pipeline: `scripts/zk/prepare-testnet.sh` and `scripts/zk/prepare-artifacts.mjs`.
4. Wallet registration path: `packages/mobile-app/src/contexts/WalletContext.tsx`.

## Architecture

```mermaid
flowchart LR
   A[Solid Sign-In] --> B[WebID]
   C[Embedded Wallet] --> D[Stellar Public Key]
   B --> E[NodeZeroIdentity register_webid]
   D --> E
   E --> F[Linked Pair Attested Off-Chain]
   F --> G[ZK Attestation Root]
   G --> H[Lockb0x update_state_root]
   H --> I[Sign-In Pairing Verification]
```

## Repository Map

1. `packages/mobile-app`: Expo web/mobile UI and auth flows.
2. `packages/contracts`: `NodeZeroIdentity`, `Lockb0x`.
3. `packages/zk-crypto`: Circuits and artifact tooling for attestation proofs.
4. `packages/embedded-wallet`: Wallet and Soroban tx submission.
5. `scripts/stellar/deploy-testnet.sh`: TestNet deployment flow.
6. `deployments/stellar-testnet.contracts.json`: Current deployed testnet IDs.

## Quick Start (Hackathon Demo)

Prerequisites:

1. Node 20+, pnpm 11+, Stellar CLI v27.
2. Rust toolchain compatible with `packages/contracts`.
3. Circom and snarkjs available.

Install dependencies:

```bash
corepack pnpm install
```

Build circuits and trusted setup:

```bash
corepack pnpm --filter @nodezero/zk-crypto build:circuits
corepack pnpm --filter @nodezero/zk-crypto build:setup
```

Deploy contracts to Stellar TestNet:

```bash
LOCKBOX_INITIALIZATION_PROOF="demo-init" \
AUTO_FUND_SOURCE_ACCOUNT=1 \
bash scripts/stellar/deploy-testnet.sh
```

Prepare ZK artifacts and manifest:

```bash
corepack pnpm prepare:zk:testnet
```

Deploy identity and lockbox contracts to Stellar TestNet:

```bash
LOCKBOX_INITIALIZATION_PROOF="demo-init" \
AUTO_FUND_SOURCE_ACCOUNT=1 \
bash scripts/stellar/deploy-testnet.sh
```

Run the app and complete onboarding to register WebID on-chain:

1. Sign in with a Solid IdP.
2. Provision wallet.
3. Register the WebID against the wallet Stellar key.

## Demo Video Outline (2-3 minutes)

1. Problem: prove a Solid Pod is linked to the signing Stellar account.
2. Show `NodeZeroIdentity` + `Lockb0x` in repo.
3. Show onboarding path that registers WebID on-chain.
4. Show lockbox root anchoring for attested identity set.
5. Show returning sign-in pairing verification flow.
6. Close with practical fit: low-friction identity attestation.

## Submission Checklist

1. Public repo link: this repository.
2. Demo video link: add link before submission.
3. Stellar network used: TestNet.
4. ZK is load-bearing: lockb0x-root-backed pairing attestation verification.
5. Known limitations documented: yes (work in progress accepted by hackathon rules).

## Future Scope

Planned, but explicitly out of scope for this milestone:

1. Proof-of-Humanity flows.
2. Nullifier-based replay-protected human uniqueness proofs.
3. Dedicated PoH verifier integration in release gates.

## Deployment References

1. Stellar TestNet + Azure release requirements:
   `docs/testnet-azure-release-requirements.md`
2. Azure Bicep templates:
   `infrastructure/azure/main.bicep`

## Current Staging TestNet Contract IDs

As of 2026-06-26, the current deployed Soroban contract IDs used for staging are:

1. Identity (`NodeZeroIdentity`):
   `CCHFYOKLGVTXEYYHWEFPI22FR26VRGG2CBBUTP6XPW3ZSIWIKEVQQ44K`
2. Lockbox (`Lockb0x`):
   `CB36LY5WZLJNMY4DHRXQER6LU3L4E5MGFYT2XSJG7ZJZV5SIIOKODT2H`

Deployment manifest source:

1. `deployments/stellar-testnet.contracts.json`

## Key Vault Secret Mapping (Staging)

These contract IDs are stored in Azure Key Vault `nodezerosocialstagingtes`:

1. `stellar-identity-contract-id`
2. `stellar-lockbox-contract-id`

Important RBAC note: this vault uses Azure RBAC authorization.
To set/update these secrets, the caller must have a role with `setSecret` permission,
for example `Key Vault Secrets Officer` (the `Key Vault Secrets User` role is read-only).
