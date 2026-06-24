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
