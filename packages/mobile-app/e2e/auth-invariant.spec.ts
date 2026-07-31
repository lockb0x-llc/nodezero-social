/**
 * e2e: Session invariant enforcement (no account required).
 *
 * Asserts the cutover contract holds for unauthenticated visitors:
 *  - signed in ⟺ valid NodeZero session; anything else lands on sign-in
 *  - the browser NEVER talks to the CSS origin
 *  - no legacy bridge/OIDC parameters or Inrupt storage keys exist
 *
 * Run against staging:
 *   STAGING_BASE_URL=https://staging.nodezero.social pnpm test:e2e
 */

import { test, expect } from '@playwright/test'

const CSS_ORIGIN_PATTERN = /solid\.nodezero\.social/

const PROTECTED_ROUTES = [
  '/feed',
  '/directory',
  '/backpack',
  '/profile',
  '/docustream',
  '/local',
  '/compose',
  '/settings',
]

// ─── I1: every protected deep link redirects to the sign-in page ────────────
for (const route of PROTECTED_ROUTES) {
  test(`I1: unauthenticated ${route} redirects to sign-in`, async ({ page }) => {
    await page.goto(route)
    // The guard redirect is client-side; wait for the URL to settle on '/'
    // rather than sampling immediately after network idle.
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', { timeout: 30_000 })
    await expect(page.getByText('Sign in to your node').first()).toBeVisible()
  })
}

// ─── I2: a tampered/garbage session token cannot enter the app ───────────────
test('I2: tampered session token is rejected and user lands on sign-in', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // Seed a forged session record; the restore path must fail closed (the
  // refresh attempt is rejected server-side and the record is destroyed).
  await page.evaluate(() => {
    window.localStorage.setItem(
      'nz.session.v2',
      JSON.stringify({
        version: 2,
        accessToken:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJodHRwczovL2V2aWwiLCJhdWQiOiJuei1zZXNzaW9uLXYxIiwiZXhwIjo5OTk5OTk5OTk5fQ.forged',
        refreshToken: 'forged-refresh-token',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        webId: 'https://solid.nodezero.social/evil/profile/card#me',
        podUrl: 'https://solid.nodezero.social/evil/',
        lockbox: null,
        createdAt: new Date().toISOString(),
      })
    )
  })

  await page.goto('/feed')
  await page.waitForLoadState('networkidle')
  expect(page.url()).toMatch(/\/$/)
  await expect(page.getByText('Sign in to your node').first()).toBeVisible()

  // The forged record must have been destroyed, not retried forever.
  const stored = await page.evaluate(() => window.localStorage.getItem('nz.session.v2'))
  expect(stored).toBeNull()
})

// ─── I3: the browser never contacts the CSS origin ───────────────────────────
test('I3: landing page issues zero requests to the CSS origin', async ({ page }) => {
  const cssRequests: string[] = []
  page.on('request', (request) => {
    if (CSS_ORIGIN_PATTERN.test(request.url())) {
      cssRequests.push(request.url())
    }
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  expect(cssRequests, `browser must not talk to CSS, saw: ${cssRequests.join(', ')}`).toHaveLength(
    0
  )
})

// ─── I4: no legacy auth artefacts exist anywhere ─────────────────────────────
test('I4: no bridge params in URL and no Inrupt storage keys', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  expect(page.url()).not.toMatch(/nz_oidc_bridge|nz_bridge_return|nz_stellar_token/)

  const inruptKeys = await page.evaluate(() =>
    Object.keys(window.localStorage).filter(
      (key) => key.startsWith('solidClientAuthn') || key.includes('solid-client-authn')
    )
  )
  expect(inruptKeys).toHaveLength(0)
})

// ─── I5: sign-in page carries no password fields and no IdP picker ──────────
test('I5: sign-in surface exposes no password input and no identity-provider picker', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.getByText('solidcommunity.net')).toHaveCount(0)
  await expect(page.getByText('Sign in to your node').first()).toBeVisible()
})

// ─── I6: empty encrypted wallet presents explicit recovery choices ─────────
test('I6: empty wallet resolves without an indefinite loading state', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('No identity on this browser', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('button', { name: 'Create new identity' }).first()).toBeEnabled()
  await expect(
    page.getByRole('button', { name: 'Restore identity from recovery bundle' }).first(),
  ).toBeEnabled()
  await expect(page.getByText('Preparing wallet…', { exact: true })).toHaveCount(0)
  await expect(page.locator('iframe[title="NodeZero wallet broker"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign In' }).first()).toBeDisabled()
})
