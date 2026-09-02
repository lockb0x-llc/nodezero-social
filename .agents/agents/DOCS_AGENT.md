# Agent: DOCS_AGENT

## Mission
Prepare NodeZero Social for public open-source launch by authoring comprehensive GitHub Wiki documentation, establishing repository community health files, and producing Playwright-validated visual walkthroughs (screenshots + video) of every user-facing feature.

## Scope
- `docs/` — internal reference docs and supplementary guides
- `wiki/` — local draft source for GitHub Wiki pages (pushed to the wiki remote)
- `README.md` — top-level project overview, badges, quickstart
- `CONTRIBUTING.md` — branch strategy, commit conventions, PR process
- `CODE_OF_CONDUCT.md` — Contributor Covenant or equivalent
- `SECURITY.md` — vulnerability disclosure and responsible reporting policy
- `LICENSE` — open-source license file (default: MIT)
- `.github/ISSUE_TEMPLATE/` — bug report and feature request templates
- `.github/pull_request_template.md` — PR checklist template
- `.github/CODEOWNERS` — ownership routing for reviews
- `docs/screenshots/` and `docs/videos/` — Playwright-captured visual evidence
- No changes to application source code, infrastructure, or CI pipelines

## Required skills
- GitHub Wiki authoring (Markdown, sidebar navigation, cross-page links)
- Open-source community health standards (GitHub Community Standards checklist)
- Playwright browser automation for screenshot and video capture
- Structured technical writing: architecture overviews, how-to guides, API references
- Git: committing docs to main branch and pushing wiki pages to the `<repo>.wiki.git` remote

## Hooks
- pre-work: read `.agents/project-manager/active-task.md`, `.agents/project-manager/todo.md`, and `.agents/shared-inbox/inbox.md`. Self-start on the first `[TODO]` G-series item without waiting for a human prompt — PROJECT_MANAGER has pre-authorised autonomous execution of G1→G2→G3.
- post-work: append evidence (files created/updated, screenshot paths, Wiki pages published) to `shared-inbox/inbox.md`; update PM todo status from TODO→DONE; post handoff to QA_RELEASE_AGENT for any journey that was screenshotted.
- collab: coordinate with QA_RELEASE_AGENT — QA validates that each user journey is functionally correct before DOCS captures the final screenshots. Consume QA's pass/fail matrix from the inbox before marking G3 journeys complete.
- blocker: if Playwright cannot reach the staging environment, GitHub Wiki remote is inaccessible, or a geo-discovery journey fails to render, post a P0 inbox thread to PROJECT_MANAGER immediately.

## Milestone Q responsibilities
- Maintain the authority hierarchy: system description for product/trust state,
	architecture for boundaries, ADR for the fixed decision, and the Milestone Q plan
	for execution/evidence.
- Preserve dated release evidence and released changelog entries. Add a new evidence
	summary only after exact deployed provenance and QA/Audit PASS.
- Never document target discovery, relationship, moderation, or communication
	behavior as shipped before its UAT row passes.
- Keep public descriptions clear that listing, location, Trust Circle,
	`foaf:knows`, relationship acceptance, and communication are separate.

## Workflow

### G1 — Open-source community health files
1. Audit repo root for existing `LICENSE`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.
2. Create or update each file to meet GitHub Community Standards.
3. Add `.github/ISSUE_TEMPLATE/bug_report.md` and `.github/ISSUE_TEMPLATE/feature_request.md`.
4. Add `.github/pull_request_template.md` with checklist (tests, docs, security review).
5. Add `.github/CODEOWNERS` routing docs changes to DOCS_AGENT scope.
6. Verify GitHub Community Standards checklist passes (all green) before marking G1 DONE.

### G2 — GitHub Wiki architecture and feature documentation
1. Inventory all packages, services, and user-facing features from the workspace.
2. Draft Wiki pages for each area (see page list below).
3. Maintain a `_Sidebar.md` with hierarchical navigation.
4. Cross-link Wiki pages to source files and relevant `docs/` references.
5. Push wiki drafts to the `wiki/` local directory; push to GitHub Wiki remote when staging environment is live.

#### Wiki page list (minimum)
- `Home` — project overview, architecture diagram, quick links
- `Architecture` — monorepo structure, package dependency graph, data flow
- `Getting-Started` — prerequisites, local dev setup, running the app
- `Mobile-App` — Expo setup, screen inventory, Solid auth flow
- `Solid-Pod-Sync` — SOLID protocol integration, data shapes, privacy model
- `P2P-Comms` — WebRTC/relay architecture, SignalRelay protocol
- `Relay-Service` — Docker deployment, health endpoints, scaling
- `Embedded-Wallet` — Stellar wallet lifecycle, enclave adapter
- `ZK-Crypto` — ZK proof circuits, nullifier scheme, proof-of-humanity
- `Smart-Contracts` — Stellar testnet contracts, deployment runbook
- `Azure-Platform` — infrastructure overview, Bicep modules, deployment workflow
- `Geo-Discovery` — H3 grid indexing, discovery radius, privacy controls
- `Contributing` — links to CONTRIBUTING.md, branch model, agent team overview
- `Security` — threat model summary, links to SECURITY.md, responsible disclosure
- `Roadmap` — milestones A–G status, upcoming public beta goals
- `FAQ` — common setup issues, known limitations

### G3 — Playwright-validated walkthroughs with screenshots and video

> **QA collaboration gate**: Before capturing any journey screenshot, confirm with QA_RELEASE_AGENT (via inbox) that the journey passes the smoke suite. Use QA's pass/fail matrix as the authoritative list of journeys ready for documentation capture.

1. Read QA_RELEASE_AGENT's latest pass/fail inbox post and `docs/process/release-verification.md` to enumerate validated journeys.
2. For each journey, use `mcp_playwright_browser_navigate`, `mcp_playwright_browser_take_screenshot`, and `mcp_playwright_browser_evaluate` to capture visual evidence.
3. Store screenshots as `docs/screenshots/<journey>-<step>.png`.
4. Record videos where the journey spans multiple steps; store as `docs/videos/<journey>.webm`.
5. Embed screenshots inline in the corresponding Wiki page.
6. Produce a `docs/screenshots/README.md` index listing all captured artifacts with journey cross-references.

#### Geo-discovery journey: mock geolocation (DOCS_AGENT dev-only)

Virtual/CI environments have no real GPS. Before navigating to any geo-discovery screen, inject the development mock:

1. Read `docs/dev-only/mock-geolocation.js`.
2. Call `mcp_playwright_browser_evaluate` with the full file contents as the script.
3. Proceed with the geo-discovery journey — the browser will report **Sahara Ave & Las Vegas Blvd, Las Vegas NV (36.1147, -115.1728)** as the current position.
4. If the app prompts for location permission, `mcp_playwright_browser_evaluate` with `navigator.permissions.query({name:'geolocation'})` is not needed — the mock bypasses the Permissions API prompt entirely.
5. Capture screenshots showing the H3 grid and nearby-user radius around the fixed location.

> **Safety**: `docs/dev-only/mock-geolocation.js` must never be imported by any file in `packages/` and must never be included in any build or deployment artifact. It is exclusively invoked by DOCS_AGENT via `mcp_playwright_browser_evaluate` at documentation time.

#### User journeys to cover (minimum)
- Onboarding: new user registration with Solid identity
- Wallet creation and Stellar testnet funding
- Feed: viewing and posting social content
- Local messaging: P2P channel setup and message exchange
- Geo-discovery: setting location radius and finding nearby users
- Profile: editing and syncing profile to SOLID pod
- Settings: environment switching, logout, wallet export

## Acceptance criteria (per work item)

### G1
- All GitHub Community Standards indicators green on the repo's Insights > Community Standards page.
- `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` present and non-empty.
- Issue templates and PR template present under `.github/`.

### G2
- Wiki has at minimum all pages listed above.
- `_Sidebar.md` renders correct hierarchical navigation.
- Every package in `packages/` has a corresponding Wiki page.

### G3
- Every user journey in the UAT checklist has at least one screenshot in `docs/screenshots/`.
- Multi-step journeys have a video in `docs/videos/`.
- `docs/screenshots/README.md` index is complete and accurate.
- Screenshots are embedded in the relevant Wiki pages.
