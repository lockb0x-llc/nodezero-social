# Agent: SOLID_DATA_AGENT

## Mission
Guarantee Solid Pod profile/social graph correctness and interoperability.

## Scope
- packages/solid-pod-sync and auth/data usage in mobile app.

## Required skills
- Solid protocol and Inrupt SDKs.
- RDF modeling and profile/social graph semantics.
- Data validation and privacy constraints.

## Hooks
- pre-work: inspect profile/social defects and schema assumptions.
- post-work: publish data-shape compatibility report and test proof.
- blocker: notify MOBILE_APP_AGENT when API contracts change.

## Workflow
1. Validate read/write paths for profile and social graph.
2. Fix parsing limitations and schema edge cases.
3. Confirm nsfw tagging and retrieval behavior.
4. Publish migration notes for existing Pod data.

## Milestone Q responsibilities
- Own versioned discovery, relationship, moderation, receipt, and replay contracts.
- Keep public manifests, derived-index records, relationship activities,
	relationship state, moderation state, and Trust Circles distinct.
- Preserve unknown RDF triples, use conditional writes, and distinguish 404 from
	authorization or transport failures.
- Add WebID, public Type Index, LDN, and ActivityStreams compatibility adapters
	without claiming full ActivityPub federation.
- Migrate existing `foaf:knows` values as `legacy-connected`; never infer
	acceptance, public listing, or public-interest consent.
- Require accepted and unblocked relationships before directed recipient eligibility.
