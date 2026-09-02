# Milestone I Release Evidence Summary

Date (UTC): 2026-07-30
Version: `0.2.0-testnet`
Environment: `staging-testnet`
Canonical PWA: `https://staging.nodezero.social`

## Release decision

**GO for the NodeZero Testnet feature baseline.** The release is suitable for
ongoing Testnet use and for pivoting development to remaining product features.
This is not a production-mainnet release.

## Automated evidence

- GitHub Actions run: `30599014484`
- Commit: `77c95112157a8f2cb36710a99e1932eb6ebe5938`
- Conclusion: `success`
- Frontend marker and API build provenance matched the commit.
- Passed: PWA artifact, environment policy, onboarding, recovery import,
  returning sign-in, memory-only browser sessions, fail-closed rejection,
  exact nine-field V3 lockb0x audit, authenticated DocuStream pane, mashlib
  runtime, and deployed bundle checks.

## Accepted physical mobile journey

The maintainer completed this retained-browser Testnet journey successfully:

1. Created a new Node.
2. Saved profile metadata to the Pod.
3. Added a DocuStream RSS source and loaded listings.
4. Signed out and closed the mobile browser.
5. Reopened the browser and navigated to `https://nodezero.social`, which
   redirected to the canonical staging PWA.
6. Used one-tap Sign In; the device wallet revalidated the V3 lockb0x and
   entered Feed.
7. Verified DocuStream restored the RSS listings.
8. Verified Profile restored the saved metadata.

## Release invariants

- The browser never contacts the CSS origin directly.
- Wallet secrets remain encrypted in profile-scoped IndexedDB.
- Access/refresh tokens remain memory-only on web.
- The provisioner session and client-side V3 commitment check must both pass.
- Profile and DocuStream persistence are Pod-backed.
- Testnet and future production-mainnet origins remain isolated.

## Deferred work

- Remaining product features and larger-scale social/feed validation.
- Optional recurring device-cloud automation and formal installed-PWA matrix.
- Production-mainnet infrastructure, contracts, approvals, and release process.