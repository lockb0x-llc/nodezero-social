# Contributing to NodeZero Social

Thanks for contributing to NodeZero Social.

## Prerequisites

- Node.js 18+
- pnpm 8+
- PowerShell (for PM orchestration scripts)
- Bash-compatible shell (for deployment and QA scripts)

## Development setup

1. Install dependencies:

```bash
pnpm install
```

2. Validate project quality gates before opening a pull request:

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm policy:validate-env
```

## Branching and commits

- Keep changes focused and scoped to one objective.
- Use clear commit messages with an optional conventional prefix, for example:
  - `feat: ...`
  - `fix: ...`
  - `docs: ...`
  - `chore: ...`
- If you use agent workflows, follow `.agents/RUNBOOK.md` and post evidence to `.agents/shared-inbox/inbox.md`.

## Pull request checklist

- Explain what changed and why.
- Link relevant issue(s).
- Include validation evidence (commands, output summary, screenshots if UI changes).
- Update docs when behavior or configuration changes.

## Coding expectations

- Keep changes minimal and avoid unrelated refactors.
- Preserve environment isolation safeguards (`development`, `staging-testnet`, `production-mainnet`).
- Do not commit secrets, credentials, or deployment tokens.

## Security reports

Do not open public issues for security vulnerabilities.

Use the private reporting path in `SECURITY.md`.
