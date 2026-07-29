# PWA Physical-Device Support Matrix

This matrix is the release contract for `staging-testnet`. Desktop Playwright,
responsive mode, and Playwright WebKit are useful development checks but never
certify a physical-device lane.

## Required lanes

| Platform | Mode | Browser/device | Automation | Release requirement |
|---|---|---|---|---|
| iOS | Browser tab | Current Safari on current supported iPhone | Device-cloud runner | Required |
| iOS | Browser tab | Safari on previous supported iOS | Device-cloud runner | Required |
| Android | Browser tab | Current Chrome on Pixel-class hardware | Device-cloud runner | Required |
| Android | Browser tab | Current Chrome on Samsung-class hardware | Device-cloud runner | Required |
| iOS | Installed PWA | Safari Add to Home Screen on owned iPhone | Human/system-UI evidence | Required for certification |
| Android | Installed PWA | Chrome Install app on owned Android device | Human/system-UI evidence | Required for certification |

The workflow [.github/workflows/pwa-device-regression.yml](../../.github/workflows/pwa-device-regression.yml)
binds all evidence to the exact live `deploy-marker.json` commit. It fails when
device-cloud credentials are absent. A certification dispatch also fails when
either installed-PWA lane is absent.

## Required cases

Every physical lane reports these case IDs as `pass`:

| Case ID | Evidence |
|---|---|
| `canonical-onboarding` | Clean canonical-origin onboarding reaches the authenticated app and records the public V3 lockb0x ID. |
| `retained-identity` | Reload/relaunch restores the same public identity and lockb0x. |
| `cold-relaunch` | Force-kill and cold launch preserve identity and reach a verified session. |
| `offline-shell` | Offline-before-launch shows the shell; private/API data is unavailable until online. |
| `signout-signin` | Sign-out destroys the session; one-tap sign-in restores the same identity. |
| `clean-device-recovery` | Recovery bundle import on a clean device restores the same identity without plaintext browser storage. |
| `update-relaunch` | Candidate update/relaunch serves the exact marker with no stale service worker. |

Each lane must also assert `sameIdentity`, `noStaleWorker`, `noPrivateCache`, and
`noPersistentToken`. Account identifiers are SHA-256-derived and truncated to
`acct_<16 hex>`; recovery material, cookies, tokens, HAR files, traces, and raw
storage dumps are never included in the summary.

## Installed-PWA procedure

1. Confirm `https://staging.nodezero.social/deploy-marker.json` matches the candidate SHA.
2. Use a clean physical device/browser profile. Run onboarding in the browser tab.
3. Install through Safari Add to Home Screen or Chrome Install app.
4. Launch standalone and verify the same public identity and V3 lockb0x.
5. Exercise force-kill, cold launch, background 30 seconds and 5 minutes, screen lock, and reboot.
6. Verify offline shell, reconnect, sign-out/sign-in, and clean-device recovery.
7. Deploy/update to the candidate, relaunch, and confirm the exact marker and no stale worker.
8. Produce only the sanitized JSON summary accepted by `pnpm qa:device:validate`.

Restricted screenshots, videos, network logs, and inspection output belong in
`docs/qa/private-device-evidence/` or the CI artifact store with 3-7 day
retention. They must be secret-scanned and are ignored by git.

## Current status

Automated staging gates cover installability, offline shell, encrypted wallet,
recovery, auth, V3 state, and application proofs. Physical-device certification
is **NO-GO until** `NZ_DEVICE_CLOUD_ENDPOINT`/`NZ_DEVICE_CLOUD_TOKEN` are
configured and a certification dispatch validates both installed-PWA summaries.