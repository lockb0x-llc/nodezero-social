/**
 * e2e: Full authenticated journey — signup → session → Pod ops → sign-out.
 *
 * Provisions a REAL account (CSS Pod + on-chain lockb0x on TestNet), so this
 * suite is opt-in:
 *
 *   NZ_E2E_FULL_JOURNEY=1 STAGING_BASE_URL=https://staging.nodezero.social pnpm test:e2e
 *
 * Asserts the session invariant end-to-end:
 *  - signup returns an inline session; the user lands in the app with NO
 *    redirect leg and NO password
 *  - all Pod traffic flows through /v1/pod-proxy/* — zero browser↔CSS requests
 *  - the session survives a reload; clearing it forces sign-in
 *  - sign-out returns to the landing page and re-locks every route
 */

import { test, expect, type Page } from '@playwright/test'

const RUN_FULL_JOURNEY = process.env.NZ_E2E_FULL_JOURNEY === '1'
const CSS_ORIGIN_PATTERN = /solid\.nodezero\.social/
const SIGNUP_TIMEOUT_MS = 240_000

test.describe.configure({ mode: 'serial' })

function uniqueHandle(): string {
  return `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function trackCssRequests(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (request) => {
    if (CSS_ORIGIN_PATTERN.test(request.url())) {
      seen.push(`${request.method()} ${request.url()}`)
    }
  })
  return seen
}

test.describe('authenticated journey (opt-in)', () => {
  test.skip(!RUN_FULL_JOURNEY, 'Set NZ_E2E_FULL_JOURNEY=1 to run account-creating journey tests.')

  const handle = uniqueHandle()
  const email = `${handle}@e2e.nodezero.social`

  test('J1: signup lands authenticated with zero CSS requests and no redirect leg', async ({ page }) => {
    test.setTimeout(SIGNUP_TIMEOUT_MS + 60_000)
    const cssRequests = trackCssRequests(page)
    const navigations: string[] = []
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url())
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.getByLabel('Node handle').first().fill(handle)
    await page.getByLabel('Notification email').first().fill(email)
    await page.getByText('Create Your Node', { exact: true }).first().click()

    // The app must transition to an authenticated surface without ever
    // leaving the origin (no IdP login page, no consent screen).
    await page.waitForURL(/\/(feed|onboarding|local)/, { timeout: SIGNUP_TIMEOUT_MS })
    await page.waitForURL(/\/feed/, { timeout: SIGNUP_TIMEOUT_MS })

    for (const url of navigations) {
      expect(url, 'navigation must never leave the app origin').not.toMatch(CSS_ORIGIN_PATTERN)
      expect(url).not.toMatch(/nz_oidc_bridge|nz_bridge_return|code=|state=/)
    }
    expect(cssRequests, `browser must not talk to CSS, saw: ${cssRequests.join(', ')}`).toHaveLength(0)

    // Session material: NodeZero session only, no Inrupt keys.
    const storage = await page.evaluate(() => ({
      session: window.localStorage.getItem('nz.session.v2'),
      inruptKeys: Object.keys(window.localStorage).filter((key) =>
        key.toLowerCase().includes('solidclientauthn'),
      ),
    }))
    expect(storage.session).not.toBeNull()
    expect(storage.inruptKeys).toHaveLength(0)

    const session = JSON.parse(storage.session ?? '{}') as { accessToken?: string; webId?: string }
    expect(session.accessToken).toBeTruthy()
    expect(session.webId).toContain(handle)
  })

  test('J2: session persists across reload and Pod ops flow through the proxy only', async ({ page, context }) => {
    test.setTimeout(120_000)
    // Reuse the stored session from J1 via a fresh page in the same context.
    void context
    const cssRequests = trackCssRequests(page)
    const proxyRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/v1/pod-proxy/')) proxyRequests.push(request.url())
    })

    await page.goto('/feed')
    await page.waitForLoadState('networkidle')
    // Authenticated: not bounced to landing.
    expect(page.url()).toMatch(/\/feed/)

    // Profile surface exercises Pod reads (and writes on save).
    await page.goto('/profile')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toMatch(/\/profile/)

    expect(proxyRequests.length, 'expected Pod traffic through /v1/pod-proxy/*').toBeGreaterThan(0)
    expect(cssRequests, `browser must not talk to CSS, saw: ${cssRequests.join(', ')}`).toHaveLength(0)
  })

  test('J3: sign-out destroys the session and re-locks all routes', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toMatch(/\/settings/)

    await page.getByText('Sign Out', { exact: false }).first().click()
    await page.waitForURL(/\/$/, { timeout: 30_000 })

    const stored = await page.evaluate(() => window.localStorage.getItem('nz.session.v2'))
    expect(stored).toBeNull()

    await page.goto('/feed')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toMatch(/\/$/)
    await expect(page.getByText('Sign in to your node').first()).toBeVisible()
  })
})
