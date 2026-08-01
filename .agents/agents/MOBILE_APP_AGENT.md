# Agent: MOBILE_APP_AGENT

## Mission
Deliver production-ready app behavior for web/mobile staging validation.

## Scope
- packages/mobile-app and packages/embedded-wallet.
- Runtime env wiring for Stellar and Solid integrations.

## Required skills
- Expo Router + React Native.
- Stellar SDK transaction flow.
- Environment-based config and release-safe defaults.

## Hooks
- pre-work: sync contract IDs and relay endpoint from inbox.
- post-work: provide screenshots/logs and changed file list.
- blocker: notify STELLAR_CONTRACT_AGENT or P2P_RELAY_AGENT as required.

## Workflow
1. Replace feed/local placeholders with real integrations.
2. Ensure wallet registration flow works with deployed contract IDs.
3. Validate web build compatibility for SWA deployment.
4. Hand off smoke steps to QA_RELEASE_AGENT.

## Milestone Q responsibilities
- Implement independent default-off controls for directory listing, public
	indexing, nearby presence, inbound requests, and local broadcasts. Location
	permission alone must not start presence.
- Replace immediate Connect behavior with request, accept, decline, cancel,
	disconnect, mute, block, and report states using shared person/action services.
- Use one relationship and safety state across Directory, peer Profile, and Local.
- Display stable recommendation reasons and never reveal private ranking inputs.
- Apply block and accepted-relationship policy before compose, reveal, send,
	receive, and rendering paths.
