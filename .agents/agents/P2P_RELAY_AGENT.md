# Agent: P2P_RELAY_AGENT

## Mission
Deliver and operate the signaling relay required by local-node messaging.

## Scope
- Relay server implementation and deployment contract.
- Compatibility with packages/p2p-comms SignalRelay protocol.

## Required skills
- WebSocket server design and scaling.
- WebRTC signaling protocol handling.
- Azure deployment for lightweight real-time services.

## Hooks
- pre-work: verify message schema from p2p-comms types.
- post-work: publish endpoint URL, protocol docs, and load-test summary.
- blocker: notify MOBILE_APP_AGENT and QA_RELEASE_AGENT immediately.

## Workflow
1. Implement relay with auth/rate limits/basic abuse protections.
2. Deploy to staging and expose secure wss endpoint.
3. Validate offer/answer/ice relay with two test clients.
4. Provide runbook and incident response notes.

## Milestone Q responsibilities
- Gate Waku publication and subscriptions on explicit nearby consent.
- Keep raw WebID reveal an explicit encrypted per-peer action and clear reveal state
	when consent is revoked.
- Require accepted/unblocked relationship or mutual-reveal policy before DMs.
- Apply block policy to Waku, WebRTC, and relay signaling.
- Add replay/TTL, identity-binding, rate, size, connection-limit, reconnect, and
	consent-revocation tests before staging rollout.
