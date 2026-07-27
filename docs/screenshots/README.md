# G3 Visual Evidence Index

Artifacts cover the public `https://nodezero.social` entry journey and the
internal `https://staging.nodezero.social` application journey after the
relevant GitHub Actions release gate passes.

## Journey to screenshot mapping

- Onboarding: `docs/screenshots/onboarding-solid-step1.png`
- Apex-to-staging onboarding evidence: `docs/screenshots/onboarding/<run>-01-apex-create.png`,
  `docs/screenshots/onboarding/<run>-02-staging-verified-feed.png`, and
  `docs/screenshots/onboarding/<run>-03-apex-returning-signin-staging-feed.png`.
  The matching `<run>-evidence.json` contains public Testnet/POD/lockb0x
  evidence only.
    Latest verified run: `ms2b99rkfq6x` on GitHub Actions staging deployment
    `30220192118` (commit `d2324a2`); its V3 child
    `CALVPRGQC44DGZPPNFSNNS3E4LMPUXRRFGWKCJJG6VDYJ2QKZGSZRNQW` passed
    `pnpm qa:audit:lockbox`.
    Repeat automation: `NZ_E2E_ITERATIONS=3 NZ_E2E_HEADLESS=true pnpm
    qa:evidence:apex-staging-onboarding:repeat`. The latest two-iteration run is
    summarized in `docs/screenshots/onboarding/repeat/ms2nj13g-repeat-summary.json`;
    both iterations passed and their individual sanitized bundles are retained
    alongside it.
- Wallet creation and testnet funding: `docs/screenshots/wallet-creation-step1.png`
- Feed view/post: `docs/screenshots/feed-view-post-step1.png`
- Local messaging: `docs/screenshots/local-messaging-step1.png`
- Geo-discovery (mock geolocation): `docs/screenshots/geo-discovery-step1.png`
- Profile sync: `docs/screenshots/profile-sync-step1.png`
- Settings/env/logout/export: `docs/screenshots/settings-env-logout-export-step1.png`

## Multi-step journey videos

- Onboarding + feed: `docs/videos/onboarding-and-feed.webm`
- Local + geo-discovery: `docs/videos/local-and-geo-discovery.webm`
- Profile + settings: `docs/videos/profile-and-settings.webm`

## Source references

- QA matrix source: `.agents/shared-inbox/inbox.md`
- Journey list source: `docs/staging-uat-checklist.md`
