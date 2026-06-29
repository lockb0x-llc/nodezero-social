# End-to-End Onboarding Validation — 2026-06-29

Interactive (Playwright) onboarding validation of the seamless "Create Your Node"
flow on `https://staging.nodezero.social`, capturing each step plus on-chain
evidence of lockb0x creation and in-app evidence of the WebID↔Stellar linkage
attestation.

## Flow under test

Landing → seamless create → server-side Solid account/Pod provisioning (CSS) →
per-user lockb0x deploy + initialize on Stellar testnet → in-app linkage notice.

- Web surface: `staging.nodezero.social` (Static Web App, seamless flag enabled)
- Provisioner: `nodezero-social-staging-testnet-provisioner.azurewebsites.net`
- Self-hosted Solid (CSS 7.1.9): `nz-staging-testnet-solid.calmwater-b7429d4d.eastus2.azurecontainerapps.io`
- Lockbox wasm hash: `795157cc49e66f79d2ce06049687d5ad20d625d38c772035dbb4e9463360885f`

## Result: PASS

| Field | Value |
| --- | --- |
| Handle | `nzval0629b` |
| WebID | `https://nz-staging-testnet-solid.calmwater-b7429d4d.eastus2.azurecontainerapps.io/nzval0629b/profile/card#me` |
| Stellar key | `GBHDBEV34ZZTNB37HNILF5NNHI7ATUY7TA7M26YABICOAO6QNANBZCT5` |
| Lockb0x (on-chain) | `CBOOKSZ744DJQ2R7JWQ4LAAMCNHX7RGL5OT2ZLWJIW4S3UFFBZ4G6HAL` |
| Pairing root | `2ad7f0c375e27d49e5dd08cc1ba020cb5348ce652a4744892f99f2bfeda11063` |

### On-chain evidence (Stellar testnet)

`api.stellar.expert/explorer/testnet/contract/CBOOKSZ744DJQ2R7JWQ4LAAMCNHX7RGL5OT2ZLWJIW4S3UFFBZ4G6HAL`

```json
{
  "contract": "CBOOKSZ744DJQ2R7JWQ4LAAMCNHX7RGL5OT2ZLWJIW4S3UFFBZ4G6HAL",
  "created": 1782752482,
  "wasm": "795157cc49e66f79d2ce06049687d5ad20d625d38c772035dbb4e9463360885f",
  "storage_entries": 3,
  "validation": { "status": "unverified" }
}
```

`storage_entries: 3` confirms the per-user lockb0x was both **deployed and
initialized** (an uninitialized deploy shows `storage_entries: 1`).

### In-app linkage attestation evidence

The success notice on the create card surfaces the WebID, the Stellar key, the
on-chain lockb0x contract ID, and the deterministic pairing root
(`sha256("NZ_POD_PAIR_V1|webId|pubkey|podUrl")`), demonstrating the in-app
linkage between the Solid Pod identity and the Stellar account anchored on-chain.

### Pod / WebID reachability

`GET .../nzval0629b/profile/card` returns the Turtle profile with
`solid:oidcIssuer` pointing at the self-hosted CSS and `a foaf:Person`.

## Screenshots

1. `onboarding-step1-landing.png` — landing with the seamless create form.
2. `onboarding-step2-filled.png` — handle + notification email entered.
3. `onboarding-step3-provisioning.png` — provisioning spinner (first run).
4. `onboarding-step3-error-contract-not-found.png` — first-run failure
   (`Contract not found: CAYCA7EM…`), root-caused below.
5. `onboarding-v3-provisioning.png` — provisioning spinner (post-fix run).
6. `onboarding-v3-success-linkage-attestation.png` — success notice with WebID,
   Stellar key, on-chain lockb0x ID, and pairing root.

## Defect found and fixed during validation

First run failed fail-closed with `Contract not found: CAYCA7EM…`. The orphaned
contract `CAYCA7EMCALOXFIS3GTCB7ZBZ5HQ3B2LSMZKAE5M4HZG73PNCOQ5EJIU` existed
on-chain with `storage_entries: 1` (deployed, never initialized).

Root cause: in the direct per-user lockb0x fallback
(`packages/jss-provisioner/src/lockboxFactory.ts`), the `initialize` invoke ran
immediately after `contract deploy` and intermittently saw the just-deployed
contract as "Contract not found" due to soroban-testnet RPC state-propagation
lag. That error was not in `initializeLockboxContract`'s transient-retry
allowlist (which only covered `Error(Storage, MissingValue)` and
`request timeout`), so it threw on the first attempt.

Fix: added "contract not found" to the transient-retry conditions and a brief
post-deploy settle delay before initialize. Re-ran end-to-end → PASS.
