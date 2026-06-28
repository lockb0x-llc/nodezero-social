/**
 * e2e tests: Navigation overflow fix + Settings-via-Profile change.
 *
 * These tests validate structural and accessibility contracts that hold
 * WITHOUT a Solid session — they run cleanly against staging with no
 * credentials required.
 *
 * Auth-gated visual assertions (authenticated nav bar shows no Settings tab,
 * Profile gear icon is visible and navigates to /settings) are documented in
 * docs/staging-uat-checklist.md under rows N1–N3 and are executed via the
 * headed browser tool after each deployment.
 *
 * Run against staging:
 *   STAGING_BASE_URL=https://staging.nodezero.social pnpm test:e2e
 */

import { test, expect } from '@playwright/test'

// ─── T1: /settings route is still reachable via direct URL ──────────────────
// The Settings tab was removed from the nav bar but the /settings route must
// remain accessible for deep-links and bookmarks.
test('T1: /settings route returns the app shell', async ({ page }) => {
  await page.goto('/settings')
  // SPA shell: Expo root element must be present.
  await expect(page.locator('#root')).toBeAttached()
  // Brand marker must be present in the document.
  const html = await page.content()
  expect(html).toContain('NodeZero')
})

// ─── T2: Nav bar contains no Settings anchor when unauthenticated ────────────
// The WebNavBar is hidden pre-auth, so no <a href="/settings"> should appear
// in the rendered DOM when the user is not logged in.
test('T2: unauthenticated page has no nav Settings link', async ({ page }) => {
  await page.goto('/feed')
  await page.waitForLoadState('networkidle')
  // Check that no anchor pointing to /settings exists in the nav bar.
  // The nav bar renders only for authenticated users; this asserts the
  // unauthenticated state is safe and correct.
  const settingsNavLink = page.locator('a[href="/settings"]')
  await expect(settingsNavLink).toHaveCount(0)
})

// ─── T3: No horizontal overflow at 375px (iPhone SE / Android mobile) ────────
test('T3: no horizontal overflow at 375px viewport width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(375)
})

// ─── T4: No horizontal overflow at 320px (minimum supported width) ───────────
test('T4: no horizontal overflow at 320px viewport width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(320)
})

// ─── T5: /profile renders app shell without horizontal overflow ───────────────
test('T5: /profile renders app shell at 375px without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/profile')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#root')).toBeAttached()
  const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(375)
})

// ─── T6: /feed renders app shell at wide viewport without errors ───────────────
test('T6: /feed renders app shell at 1280px without JS errors', async ({ page }) => {
  const jsErrors: string[] = []
  page.on('pageerror', (err) => jsErrors.push(err.message))

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/feed')
  await page.waitForLoadState('networkidle')

  await expect(page.locator('#root')).toBeAttached()
  // Filter out known non-blocking errors (e.g. background 401 fetch noted in UAT FE1)
  const blocking = jsErrors.filter((e) => !e.includes('401') && !e.includes('NetworkError'))
  expect(blocking).toHaveLength(0)
})

// ─── T7: Landing shows always-visible sign-in card ─────────────────────────
test('T7: landing shows Solid sign-in card by default', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('Sign in with your Solid Pod')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Identity Provider URL' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
})

// ─── T8: Legacy hero buttons are removed from landing ──────────────────────
test('T8: landing no longer renders legacy hero toggle buttons', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('Create Your Node  →')).toHaveCount(0)
  await expect(page.getByText('Already have a Pod? Sign In')).toHaveCount(0)
})

// ─── T9: Settings exposes lockbox lifecycle metadata rows ───────────────────
test('T9: settings includes lockbox metadata rows', async ({ page }) => {
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('Lockb0x Factory')).toBeVisible()
  await expect(page.getByText('User Lockb0x')).toBeVisible()
  await expect(page.getByText('Lockb0x Idempotency')).toBeVisible()
})
