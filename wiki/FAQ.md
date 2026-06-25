# FAQ

## Why are there multiple environment profiles?

Profiles enforce isolation between development, staging-testnet, and production-mainnet.

## How do I run staging smoke checks?

Run `pnpm qa:smoke` (or `bash scripts/qa/staging-smoke.sh`) against a live staging domain.

## Where is deployment infrastructure documented?

See `infrastructure/azure/README.md` and `docs/staging-deployment-blueprint.md`.

## Where is PM coordination tracked?

Use `.agents/project-manager/todo.md` and `.agents/shared-inbox/inbox.md`.
