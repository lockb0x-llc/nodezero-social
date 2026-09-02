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

## Discovery and communication safety

- Public directory listing, public indexing, nearby presence, identity reveal,
  inbound requests, broadcasts, and notification channels are independent and
  default off when introduced.
- Pod records are authoritative. The operator directory is a rebuildable projection
  of explicit public manifests and never relationship authority.
- A local block overrides discovery, profile actions, compose, LDN delivery, Waku,
  and relay behavior.
- Public indexes and telemetry exclude private interests, Trust Circles, blocks, H3
  history, reveal history, relationship payloads, and message content.
- External WebID and inbox requests use a credential-free, HTTPS-only,
  SSRF-resistant server path. The Pod Access Proxy is not a general remote fetcher.
- Inbox processing uses bounded payloads, sender verification, immutable activity IDs,
  replay suppression, expiry, and quarantine before state mutation.

## Related docs

- `docs/environment-isolation-matrix.md`
- `docs/standards/known-non-conformance.md`
- `docs/archive/2026-pre-staging/testnet-azure-release-requirements.md` (archived)
- `docs/system-description.md`
- `docs/adrs/consentful-discovery-communication/ADR-001-consentful-discovery-and-communication.md`
