# Security

See repository-level policy in `SECURITY.md`.

## Security posture areas

- Environment isolation and deployment controls.
- Secret handling and no-credential-in-repo policy.
- Responsible vulnerability disclosure path.

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
