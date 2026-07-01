# Governance

NodeZero Social is a community-developed project. This document describes how
decisions are made and how the project is maintained.

## Maintainers

See [`MAINTAINERS.md`](MAINTAINERS.md) for the current list of maintainers and
their areas of ownership.

## Decision process

All changes are proposed via GitHub pull requests and require at least one
maintainer approval before merging. For significant architectural changes
(new protocols, contract upgrades, environment-isolation changes), two
maintainer approvals are required.

Decisions are documented in PR descriptions and, where they affect deployed
behaviour, in `docs/staging-runtime-implementation-roadmap.md`.

## Release authority

Releases are tagged from the `main` branch by any maintainer. The staging
deploy (`testnet` branch) can be triggered by any maintainer via the
`Staging Deploy` workflow dispatch. Production deployment (when available)
requires explicit maintainer sign-off and a passing UAT checklist.

## Security escalation

Do not open public issues for security vulnerabilities. Use the private
disclosure path described in [`SECURITY.md`](SECURITY.md).

## Environment isolation policy

The environment isolation matrix (`docs/environment-isolation-matrix.md`) is
the authoritative policy for staging/mainnet separation. Changes to it require
two maintainer approvals. The CI policy script (`pnpm policy:validate-env`) is
a required gate and must not be bypassed.

## Amendments

This document is amended by pull request. Amendments to governance itself
require two maintainer approvals.
