# NodeZero Agent Operations

This folder defines the working agreement for a multi-agent team delivering staging.nodezero.social.

## Structure
- agents/: role cards and operating instructions.
- project-manager/todo.md: canonical PM task board.
- project-manager/parallel-work-items.json: branch-level parallel assignment plan.
- project-manager/merge-queue.txt: ordered reintegration queue.
- shared-inbox/inbox.md: append-only communication channel across agents.

## Shared inbox protocol
- One message per update.
- Prefix with: [DATE] [FROM->TO] [PRIORITY] [STATUS]
- Include: context, action requested, blocking dependencies, expected response time.

## Hook protocol
- pre-work hook: read inbox + PM todo for your assigned items.
- post-work hook: append evidence, changed files, risks, and next handoff target.
- blocker hook: if blocked >30 minutes, notify PM and dependent agents immediately.

## Definition of done (global)
- Code merged or docs updated.
- Tests/checks run or explicitly deferred with rationale.
- Inbox handoff posted.
- PM todo status updated.
