/**
 * Playwright configuration for NodeZero.social e2e tests.
 *
 * Targets the staging environment by default. Override via:
 *   STAGING_BASE_URL=https://staging.nodezero.social pnpm test:e2e
 *
 * Browser matrix optimised for the web-only app:
 *   - chromium  → covers Chrome, Edge, Brave
 *   - webkit    → Safari-approximate (macOS/iOS behaviour)
 *
 * Auth-gated visual tests (authenticated nav bar, profile gear icon) require
 * a live Solid session and are covered by manual UAT rows N1–N3 in
 * docs/staging-uat-checklist.md. The automated suite tests structural and
 * accessibility contracts that hold without authentication.
 */

import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.STAGING_BASE_URL ?? 'https://staging.nodezero.social'

export default defineConfig({
  testDir: './packages/mobile-app/e2e',

  // Fail the suite immediately on the first test failure in CI to keep
  // feedback fast. Locally, run all tests to surface all issues at once.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 720 },
    // Capture artefacts only on failure to keep runs lean.
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // Output artefacts alongside test files so CI artefact upload is trivial.
  outputDir: 'playwright-results',
})
