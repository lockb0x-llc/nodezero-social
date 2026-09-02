# ZK Pod-Ownership Attestation

**Status date:** 2026-09-01 · **Status:** Deployed on Stellar Testnet
**Circuit:** `pod_stellar_bridge_v3` · **Proof system:** Groth16 over BN254

---

## ⚠ Trust boundary — read first

> **Proof verification is performed OFF-CHAIN by the NodeZero provisioner.** The chain
> stores only a `ProofHash`. The contract attests that *the provisioner accepted a proof*,
> not that *the chain verified one*.
>
> A compromised provisioner could anchor a `ProofHash` for an unverified proof, and the
> on-chain 9-field audit would still pass — it checks for nonzero 32-byte values, not proof
> validity.
>
> This is a legitimate architecture. Earlier documentation described it as "on-chain
> pre-flight checks", which overstated it. Tracked as [NC-04](known-non-conformance.md).

---

## 1. Purpose

Each user proves in the browser that they control their Solid Pod, without revealing the
Pod credential. The resulting proof is committed to a per-user Soroban `lockb0x` contract
alongside an encrypted claim, producing a durable public anchor for the identity.

This anchor gates returning sign-in: the client independently verifies the on-chain
commitment (`attestationStatus === 'verified'`) as a **second gate** after session
issuance. Both must pass.

## 2. Naming correction

The deployed circuit is **`pod_stellar_bridge_v3`**, with public signals:

```
[ claimHash, accountCommitment, podBinding ]
```

Several older documents named it `pod_ownership` with a legacy
`[root, nullifier, scope]` layout. That name and layout are **obsolete**. The byte
serialization is unchanged, so there was no functional defect — but the identifier was
wrong in six documents and in a source comment in `packages/zk-crypto/src/serializer.ts`.

## 3. Proof format

Groth16 over BN254, serialized big-endian in 32-byte limbs:

| Component | Group | Bytes |
|---|---|---|
| `pi_a` | G1 | 64 |
| `pi_b` | G2 | 128 |
| `pi_c` | G1 | 64 |
| **Total** | | **256** |

Enforced fail-closed in `packages/jss-provisioner/src/bridgeProofVerifier.ts`:
a payload that is not exactly 256 bytes throws.

## 4. Identity commitment

```
accountCommitment = keccak256(stellarPublicKey) mod SNARK_FIELD_SIZE
```

Poseidon is used for in-circuit hashing. The commitment binds the on-chain identity to the
device Stellar key.

## 5. Deployed contracts (Stellar Testnet)

Recorded in `deployments/stellar-testnet.contracts.json` and
`deployments/zk-testnet-lockbox-bridge-v3-artifacts.json` — verified consistent across all
16 referencing files, with real transaction hashes.

| Component | Contract ID |
|---|---|
| Lockb0x Bridge Factory v3 | `CDFHCQA3YJCITWEMNLCSRGQVVFEXGTONWSQJTD5VIZO7YV4IOKZUPCGT` |
| Bridge Verifier v3 | `CDQKUKF2AB2UIGNMXM2DTE7JDV5OMPRUDBYOW7OVMYXXUK2UTIFVXMIF` |

**Mainnet:** no contracts exist. See [NC-06](known-non-conformance.md).

## 6. Verification key integrity

The provisioner fetches the verification key over HTTP under a **SHA-256 digest pin**. A
VK that does not match the pinned digest is rejected. This is good practice and materially
limits the off-chain verification risk in §NC-04.

## 7. The 9-field on-chain audit

`scripts/qa/lockbox-auditor.mjs` is the strongest verification artifact in the repository
and is **blocking** in `staging-deploy.yml`. It enforces an exact-set, exact-count,
sorted-order match on each release-created child contract's instance storage:

```
AccountCommitment · Ciphertext · CiphertextHash · CircuitVersion ·
ClaimHash · Factory · Operator · PodBinding · ProofHash
```

Plus: no duplicate keys; `Factory` equals the audited factory; `Operator` is a valid
`[GC][A-Z0-9]{55}`; `AccountCommitment` equals the indexed event topic;
`PodBinding` / `ClaimHash` / `ProofHash` / `CiphertextHash` are nonzero 32-byte values;
`Ciphertext` is non-empty and ≤ 4096 bytes; `CircuitVersion === 3`.

**What it does not do:** verify the Groth16 proof. See the trust boundary above.

## 8. Stellar protocol context

Stellar's native ZK host functions (CAP-0074 BN254 pairing, CAP-0075 Poseidon, CAP-0080
BN254 MSM) are relevant to a future move toward genuine on-chain verification, which would
close [NC-04](known-non-conformance.md).

## 9. References

- [Groth16](https://eprint.iacr.org/2016/260) · [BN254](https://hackmd.io/@jpw/bn254) · [circom](https://docs.circom.io/) · [snarkjs](https://github.com/iden3/snarkjs)
- [Soroban](https://developers.stellar.org/docs/smart-contracts)
- Implementation: [`packages/zk-crypto`](../../packages/zk-crypto), [`bridgeProofVerifier.ts`](../../packages/jss-provisioner/src/bridgeProofVerifier.ts), [`lockbox-auditor.mjs`](../../scripts/qa/lockbox-auditor.mjs)
