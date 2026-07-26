# Multi-Agent Runbook

This runbook explains how to execute the agent team to deliver staging.nodezero.social.

## 1. Team roster
- PROJECT_MANAGER
- STELLAR_CONTRACT_AGENT
- AZURE_PLATFORM_AGENT
- MOBILE_APP_AGENT
- SOLID_DATA_AGENT
- P2P_RELAY_AGENT
- QA_RELEASE_AGENT
- AUDIT_AGENT
- DOCS_AGENT

Role cards are located in .agents/agents.

## 2. Daily operating cycle

Step 1: PM kickoff
- Review .agents/project-manager/todo.md
- Post top priorities in .agents/shared-inbox/inbox.md
- Assign owners and due times

Step 2: Specialist execution
- Each specialist runs pre-work hook from role card
- Works only inside defined scope
- Posts progress and evidence to shared inbox

Step 3: Handoff validation
- Downstream agent acknowledges receipt in inbox
- PM verifies dependency closure

Step 4: End-of-day closeout
- PM updates todo statuses
- QA_RELEASE_AGENT reports quality deltas
- PM publishes next-day focus

## 3. Message templates

Template: assignment
[YYYY-MM-DD HH:MM UTC] [PROJECT_MANAGER->AGENT_NAME] [P1] [OPEN]
Context: <goal>
Request: <specific task>
Evidence: <required artifact>
Due: <timestamp>

Template: handoff
[YYYY-MM-DD HH:MM UTC] [AGENT_A->AGENT_B] [P1] [DONE]
Context: <what changed>
Request: <validation requested>
Evidence: <file paths, logs, checks>
Due: <timestamp>

Template: blocker
[YYYY-MM-DD HH:MM UTC] [AGENT_NAME->PROJECT_MANAGER] [P0] [NEEDS-INFO]
Context: <blocking issue>
Request: <decision needed>
Evidence: <error output or repro>
Due: immediate

## 4. Workflow gates

Gate A: Foundation gate
- CI scripts and package consistency validated.

Gate B: Functional gate
- Feed, local messaging, and profile integrity verified.

Gate C: Chain gate
- Contract deployment manifests validated and reproducible.

Gate D: Cloud gate
- Azure infra deployed, staging domain active, telemetry healthy.

Gate E: Release gate
- QA pass matrix complete and PM GO decision posted.

## 5. Hook implementation guidance

Pre-work hook checklist:
- Read unresolved inbox items addressed to your role.
- Read PM todo items in your scope.
- Confirm no conflicting ownership.

Post-work hook checklist:
- Post changed files and summaries.
- Post validation evidence.
- Post explicit next owner for handoff.

Blocker hook checklist:
- Describe blocker in one paragraph.
- Include impact and latest possible decision time.
- Tag all dependent agents.

## 6. PM governance rules

- One in-progress owner per task.
- No task closed without objective evidence.
- P0 blockers pause dependent work.
- Scope changes require inbox announcement.

## 6a. Branching strategy (established 2026-06-25)

### Branch hierarchy
```
main          ← production-ready; protected; only receives PRs from testnet
  └── testnet ← staging integration branch; all agent work lands here first
        ├── agents/<agent>/<task-id>-<slug>  ← specialist feature branches
        └── agents/pm/<task-id>-<slug>        ← PM coordination branches
```

### Rules
- **Agents NEVER push directly to `main`.** All work targets `testnet` or sub-branches of `testnet`.
- Feature branches (`agents/*`) are created off `testnet`, not `main`.
- PM reintegrates completed agent branches INTO `testnet` (not `main`).
- QA_RELEASE_AGENT runs the full smoke suite against `testnet`-based staging before any promotion.
- Only after PM + QA explicit DONE sign-off does PM open a PR: `testnet → main`.
- The `main → testnet` merge happens at the start of each sprint to keep `testnet` up to date.

### Dispatch workflow (updated)
1. `pnpm pm:dispatch` — creates branches off `testnet` (not `main`).
2. Agents work in their branch, post DONE to inbox.
3. PM reintegrates agent branches → `testnet`: `pnpm pm:reintegrate`.
4. QA_RELEASE_AGENT validates `testnet` on staging.
5. PM opens PR `testnet → main` only after QA pass.

### Why branch protection on Free plan is still useful
GitHub Free enforces protection rules for public repos. If the repo is public, the CI-pass requirement on `main` is enforced. If private, consider making it public once the open-source documentation milestone (G) is complete.

## 7. Quality and release policy

Minimum release policy for staging:
- No open P0 defects.
- No unresolved security-critical infra issues.
- Smoke suite pass for auth, profile, feed, local messaging, and wallet registration.
- Monitoring dashboards and alerts active.

## 8. Start command for this repository process

1) PM sets first assignments for A1, A2, A3 tasks.
2) Specialists execute and post evidence.
3) PM promotes tasks to IN_PROGRESS/DONE in todo board.
4) Repeat until Gate E passes.

## 9. Milestone G — PM-orchestrated autonomous documentation

The PM drives the entire G-series without operator intervention. Start it with a single prompt:

> **Operator prompt**: "You are PROJECT_MANAGER. Execute Milestone G end-to-end per the RUNBOOK section 9 protocol."

### G-series execution protocol (PM runs this autonomously)

Step 1 — Verify dispatch
- Confirm G1/G2/G3 worktrees exist under `.agent-worktrees/`.
- If missing: `pnpm pm:dispatch` to create them.

Step 2 — Kick off G1 (community health files)
- Post P1 OPEN assignment to DOCS_AGENT in inbox.
- In the G1 worktree (`.agent-worktrees/G1-docs-agent`), invoke DOCS_AGENT with: "Execute G1 per active-task.md and role card."
- DOCS_AGENT self-starts: creates LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, .github templates; commits; posts DONE to inbox.

Step 3 — Reintegrate G1, kick off G2
- On DOCS_AGENT DONE signal: add `agents/docs-agent/G1-open-source-community-health-files` to merge-queue.txt; run `pnpm pm:reintegrate`.
- Immediately post G2 assignment to DOCS_AGENT.
- DOCS_AGENT authors Wiki pages in `.agent-worktrees/G2-docs-agent`; commits; posts DONE.

Step 4 — G3 QA collaboration gate
- On G2 DONE signal: post concurrent assignments to both agents:
  - QA_RELEASE_AGENT (P1): "Run smoke suite against staging.nodezero.social; post journey pass/fail matrix to inbox as signal for DOCS_AGENT G3."
  - DOCS_AGENT (P1): "Await QA_RELEASE_AGENT pass/fail matrix in inbox before capturing any screenshot. When matrix arrives, proceed with G3 per role card."
- QA_RELEASE_AGENT posts matrix → DOCS_AGENT reads it → DOCS_AGENT captures only PASS journeys.
- For geo-discovery: DOCS_AGENT injects `docs/dev-only/mock-geolocation.js` via `mcp_playwright_browser_evaluate` (dev-only, never deployed).

Step 5 — Reintegrate G2 then G3
- On G3 DONE: add G2 then G3 to merge-queue.txt in order; run `pnpm pm:reintegrate`.
- Update todo.md: G1, G2, G3 → DONE.
- Post Gate G pass notice to inbox.

### Gate G: Documentation gate (new)
- All GitHub Community Standards indicators green.
- Wiki has minimum page set with _Sidebar.md navigation.
- Every UAT journey has a screenshot; multi-step journeys have video.
- `docs/screenshots/README.md` index is present.
- PM posts explicit GO for public repo visibility.

## 9. Parallel branch orchestration

Use this flow to run multiple specialist agents at the same time without branch collisions.

Preparation:
- Keep PM source-of-truth tasks in .agents/project-manager/parallel-work-items.json.
- Keep integration order in .agents/project-manager/merge-queue.txt.
- Ensure your main working tree is clean before dispatch.

Dispatch parallel branches and worktrees:
1) Optional preview:
	- pnpm pm:dispatch:dry
2) Create branches/worktrees and publish inbox assignments:
	- pnpm pm:dispatch

What dispatch does:
- Creates branch pattern: agents/<agent>/<task-id>-<slug>
- Creates worktree: .agent-worktrees/<task-id>-<agent>
- Writes task brief to each worktree at .agents/project-manager/active-task.md
- Appends assignment messages to .agents/shared-inbox/inbox.md

Reintegrate completed branches:
1) Add reviewed branches to .agents/project-manager/merge-queue.txt in merge order.
2) Optional preview:
	- pnpm pm:reintegrate:dry
3) Merge + validate:
	- pnpm pm:reintegrate

Continuous follow-up loop:
1) Check branch state and inbox progress:
	- pnpm pm:status
2) Post reminders for stale or idle branches:
	- pnpm pm:followup
3) Re-run status after reminders to confirm movement.
4) Run recurring status + follow-up on a cadence:
	- pnpm pm:loop
	- pnpm pm:loop:dry

What status reports:
- Worktree state per dispatched branch.
- Most recent PM touchpoint per agent.
- Whether the branch only contains the task brief or has real work in progress.

What follow-up does:
- Appends reminder messages for branches that are idle or stale.
- Keeps the shared inbox aligned with actual PM oversight.
- Provides a repeated coordination signal without manual branch inspection.

What loop mode does:
- Runs status and follow-up together repeatedly.
- Defaults to continuous operation until stopped.
- Supports dry-run and bounded iterations for validation.

Default reintegration validation command:
- pnpm lint; pnpm type-check; pnpm test; pnpm policy:validate-env

Override validation command example:
- pwsh -NoProfile -File ./scripts/agents/reintegrate-parallel.ps1 -ValidationCommand "pnpm lint; pnpm type-check; pnpm policy:validate-env"
