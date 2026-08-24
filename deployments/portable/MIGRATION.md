# Portable staging migration

This deployment shape runs NodeZero on any Linux host with Docker Compose. It is
the candidate replacement for the Azure staging/testnet environment.

## Cutover gates

Do not retire Azure until all of these are complete:

1. A dedicated host is provisioned with SSH keys only, a firewall, automatic
   security updates, and encrypted off-host backups.
2. Real staging values are installed in an untracked `.env` file. Never use
   `.env.example` for deployment.
3. `deploy.sh` builds and starts every container successfully.
4. `healthcheck.sh` passes for web, provisioner, Solid, and relay endpoints.
5. `pnpm qa:smoke:auth` passes against the portable staging host.
6. Two-account relationship, block, Trust Circle, Feed, Directory, and
   communication journeys pass with retries disabled.
7. Pod data backup and restore are exercised successfully.
8. DNS is lowered, switched to the portable host, and monitored through one
   complete rollback interval.
9. Azure rollback remains possible until the portable host is accepted by the
   release owner.

## Cutover order

1. Deploy the portable stack under temporary staging hostnames.
2. Verify TestNet RPC, contract IDs, ZK manifest, provisioner session issuance,
   Pod persistence, and relay identity checks.
3. Run the complete staging QA matrix against the temporary host.
4. Create and verify an encrypted off-host backup.
5. Switch staging DNS and monitor.
6. Keep Azure resources intact during the observation window.
7. After explicit acceptance, export any required Azure evidence, then retire
   Azure resources in a separate change with its own rollback record.

## Scope

This file covers `staging-testnet` only. Production MainNet requires a separate
environment file, contract manifest, hostnames, keys, and release approval.
The portable stack must never mix staging and production values.