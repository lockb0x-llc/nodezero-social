# v0.2.0 Testnet Release

Released: 2026-07-30

`v0.2.0-testnet` establishes the NodeZero installable PWA as the feature
baseline for continued Testnet development.

## User journeys accepted

- Create an encrypted device identity and a new Node.
- Generate and verify the browser-side ZK Pod-ownership proof.
- Create the Solid Pod/WebID and exact V3 lockb0x anchor.
- Save and reload Profile metadata from the Pod.
- Add a DocuStream RSS source and reload its listings.
- Sign out, close/reopen the mobile browser, and return through one-tap Stellar
  sign-in with the same wallet, WebID, Profile, and DocuStream state.
- Restore an identity from a profile/network-bound recovery bundle.

## Security baseline

- Canonical Testnet PWA origin: `https://staging.nodezero.social`.
- Encrypted IndexedDB wallet with non-extractable AES-GCM wrapping key.
- No wallet secret or browser bearer token in localStorage.
- HttpOnly, Secure, host-only browser session cookie on the provisioner API.
- No browser-to-CSS authentication traffic; Pod operations use the Pod Access Proxy.
- Client-side commitment comparison against the exact on-chain V3 lockb0x.

## Release evidence

- Commit: `77c95112157a8f2cb36710a99e1932eb6ebe5938`
- GitHub Actions run: `30599014484` (`success`)
- Milestone evidence: ../docs/milestone-i-release-evidence-summary.md
- UAT checklist: ../docs/staging-uat-checklist.md

## Scope boundary

This release is Testnet-only. Production-mainnet remains isolated and requires
its own infrastructure, contract deployment, physical-device certification,
approvals, and release process.