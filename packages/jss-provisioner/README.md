# @nodezero/jss-provisioner

Custody attestation and identity provisioning service scaffold for NodeZero.

## Endpoints

- `GET /health`
- `POST /v1/bootstrap-challenge`
- `POST /v1/provision`
- `GET /v1/provision/:jobId`

## Lockbox factory metadata

`POST /v1/provision` and `GET /v1/provision/:jobId` now include a `lockbox`
object with idempotent per-user lockbox metadata.

- `status`: `ready`, `skipped`, or `error`
- `mode`: `mock` or `disabled`
- `factoryContractId`: configured factory contract ID (or `null`)
- `userLockboxContractId`: stable per-user lockbox ID in `mock` mode
- `idempotencyKey`: stable key derived from `webId` and `stellarPublicKey`

Environment variables:

- `JSS_LOCKBOX_FACTORY_CONTRACT_ID` (or `NZ_LOCKBOX_FACTORY_CONTRACT_ID`)
- `JSS_LOCKBOX_FACTORY_MODE` (`mock` by default, `disabled` to skip, `soroban` for live invoke)

Soroban mode (`JSS_LOCKBOX_FACTORY_MODE=soroban`) additionally requires:

- `JSS_STELLAR_SOURCE_ACCOUNT` (source account alias/identity available to `stellar` CLI)
- `JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS` (operator address configured on factory initialize)
- Optional `JSS_STELLAR_RPC_URL` and `JSS_STELLAR_NETWORK_PASSPHRASE`

In `soroban` mode, the provisioner invokes factory method:

- `get_or_create_user_lockbox(caller,user,salt,initial_root)`

and parses the returned contract ID for `userLockboxContractId`.

## Challenge format

The server canonicalizes challenge payloads as:

`NZ_ATTEST_V1|domain|envProfile|nonce|expiresAt|handle|webId|podUrl`

Clients sign this exact payload using the embedded Stellar key. The provisioner
verifies signature validity against `stellarPublicKey`.

## Development

From workspace root:

```bash
corepack pnpm provisioner:dev
```

Type-check only:

```bash
corepack pnpm provisioner:type-check
```
