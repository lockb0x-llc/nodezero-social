# Consentful Discovery And Communication

Milestone Q turns NodeZero's existing Directory, Pod social graph, Trust Circle,
nearby presence, and messaging primitives into one consentful social lifecycle.

## Core rules

- The Pod is authoritative for discovery consent, relationship state, moderation,
  inbox activities, and durable notification state.
- The Community Directory is a rebuildable projection of explicit public manifests.
- Public listing, public indexing, nearby presence, nearby identity reveal, inbound
  requests, local broadcasts, and notification channels are separate choices.
- Directory, recommendations, OS location permission, Trust Circle membership, and
  unilateral `foaf:knows` state do not grant directed communication.
- Accepted and unblocked relationships are required for directed audiences.
- A local block overrides Directory, Profile, compose, Solid delivery, Waku, and relay
  behavior.
- Private interests, Trust Circles, blocks, H3/reveal history, and communication
  activity are never indexed.

## Standards boundary

NodeZero uses WebID, Solid public Type Indexes, Linked Data Notifications,
ActivityStreams relationship payloads, and a `foaf:knows` compatibility projection.
This does not mean NodeZero implements full ActivityPub federation.

## Delivery plan

1. Publish an explicit minimal discovery manifest from the owner's Pod.
2. Discover candidates through exact WebID, the opt-in directory, selected public
   interests, accepted mutual connections, or ephemeral mutual nearby reveal.
3. Explain why each person is shown.
4. Send a durable relationship request to the inbox advertised from the WebID.
5. Accept, reject, cancel, disconnect, mute, block, or report.
6. Communicate only through an authorized durable or low-latency channel.

See the repository
[system description](../docs/system-description.md),
[architecture](../docs/architecture.md), and
[implementation plan](../docs/consentful-pod-owner-discovery-and-communication-plan.md)
for the complete design and release gates.
