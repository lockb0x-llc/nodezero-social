# Security

See repository-level policy in `SECURITY.md`.

## Security posture areas

- Environment isolation and deployment controls.
- Secret handling and no-credential-in-repo policy.
- Responsible vulnerability disclosure path.
- Identity/auth separation of concerns: onboarding and authentication
  (Solid OIDC + Soroban lockb0x + ZK attestation) are release-gated
  independently of application features.

## Authentication and verification

- New users choose their own password (min 12 chars) at onboarding; the
  provisioner rejects missing/short passwords and never issues credentials
  the user does not know.
- Seamless sign-in uses a one-time OIDC bridge ticket passed as top-level
  URL params to the IdP login page, with a validated `nz_return` (allowlisted
  first-party origins only — no open redirect). The template authenticates
  via the CSS account API and returns control to the app, which resumes the
  standard OIDC flow.
- Sessions are fail-closed: routing only admits sessions whose on-chain
  lockb0x pairing attestation verifies; unverified sessions are forced
  through `/onboarding`.
- Blocking staging gate: `pnpm qa:smoke:auth`
  (`scripts/qa/staging-auth-evidence.mjs`) verifies new-user onboarding and
  returning-user authentication end-to-end, including on-chain evidence.

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
