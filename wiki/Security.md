# Security

See repository-level policy in `SECURITY.md`.

## Security posture areas

- Environment isolation and deployment controls.
- Secret handling and no-credential-in-repo policy.
- Responsible vulnerability disclosure path.
- Identity/auth separation of concerns: onboarding and authentication
  (internal Stellar signature + Soroban lockb0x + ZK attestation) are release-gated
  independently of application features.

## Authentication and verification

- The user's credential is the device Stellar keypair. There are no
  user-facing passwords, OIDC redirects, or bridge tickets.
- Browser wallet records are AES-256-GCM encrypted in profile-scoped IndexedDB;
  the wrapping key is non-extractable and no wallet secret enters localStorage.
- Web access/refresh tokens stay in memory. Reload restoration uses an HttpOnly,
  Secure, host-only `__Host-` cookie on the provisioner API.
- The browser never contacts CSS directly; all Pod operations use
  `/v1/pod-proxy/*` and server-held encrypted client credentials.
- Sessions are fail-closed: routing only admits sessions whose on-chain
  lockb0x pairing attestation verifies; unverified sessions are forced
  through `/onboarding`.
- Blocking staging gate: `pnpm qa:smoke:auth`
  (`scripts/qa/staging-auth-evidence.mjs`) verifies new-user onboarding and
  recovery, returning authentication, memory-only sessions, fail-closed
  rejection, and exact on-chain V3 evidence.

## ACL Namespace Hardening

NodeZero defends ACL integrity with namespace policy checks to prevent malformed
or cross-account ACL persistence.

### Threat model

- Namespace confusion for path-based pod owners.
- Malformed ACL writes from buggy client or automation writers.
- Cross-account ACL authority escalation attempts.

### Invariants

- ACL owner principal must match the ACL target resource namespace.
- ACL target resources must remain inside the same account namespace.
- Malformed ACL payloads are denied fail-closed.

### Rule IDs and deny contract

- `ACL_NS_OWNER_MISMATCH`
- `ACL_NS_TARGET_MISMATCH`
- `ACL_PAYLOAD_MALFORMED`
- `ACL_PRINCIPAL_NOT_ALLOWLISTED`

Policy denials return HTTP 4xx with `ruleId`, `reason`, `targetPath`, and
`correlationId` for incident triage.

### Decision telemetry

Security events capture policy decisions using: `decision`, `ruleId`,
`targetPath`, `principal`, `correlationId`, and `timestamp`.

## Related docs

- `docs/environment-isolation-matrix.md`
- `docs/testnet-azure-release-requirements.md`
