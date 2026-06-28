# @nodezero/jss-provisioner

Custody attestation and identity provisioning service scaffold for NodeZero.

## Endpoints

- `GET /health`
- `POST /v1/bootstrap-challenge`
- `POST /v1/provision`
- `GET /v1/provision/:jobId`

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
