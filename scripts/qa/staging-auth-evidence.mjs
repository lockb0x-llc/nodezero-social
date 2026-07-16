#!/usr/bin/env node

/**
 * staging-auth-evidence.mjs
 *
 * Blocking onboarding + authentication E2E evidence for staging.
 *
 * Session contract under test (fail-closed, no legacy paths):
 *   signed in ⟺ the provisioner minted a NodeZero session after proving live
 *   Solid access (client credentials → DPoP token → Pod probe). The browser
 *   NEVER contacts the CSS origin; all Pod traffic flows through the
 *   provisioner Pod Access Proxy (/v1/pod-proxy/*).
 *
 * Journeys:
 *  1. New user: create node → ZK proof → Pod → on-chain anchor → inline
 *     NodeZero session → authenticated app surface. Zero redirect legs.
 *  2. Returning user: one-tap Stellar signature sign-in → session → app.
 *  3. Negative: a destroyed/tampered session must land on the sign-in page.
 *
 * On-chain evidence: the per-user lockb0x contract returned at signup is
 * verified via stellar.expert (storage_entries >= 3 ⇒ deployed + initialized
 * + attested).
 *
 * Usage:
 *   node scripts/qa/staging-auth-evidence.mjs
 *   STAGING_BASE_URL=https://staging.nodezero.social node scripts/qa/staging-auth-evidence.mjs
 */

import { chromium } from '@playwright/test'

const baseUrl = (process.env.STAGING_BASE_URL || 'https://staging.nodezero.social').replace(/\/$/, '')
const solidHost = (process.env.SOLID_HOST || 'solid.nodezero.social').toLowerCase()
const createTimeoutMs = Number(process.env.AUTH_E2E_CREATE_TIMEOUT_MS || 8 * 60 * 1000)
const sessionTimeoutMs = Number(process.env.AUTH_E2E_SESSION_TIMEOUT_MS || 4 * 60 * 1000)

const SESSION_STORAGE_KEY = 'nz.session.v2'

function log(message) {
  console.log(`[auth-evidence] ${message}`)
}

function fail(message) {
  console.error(`[auth-evidence] FAIL: ${message}`)
  process.exit(1)
}

function nowStamp() {
  return Date.now().toString(36)
}

function randomSuffix() {
  return Math.floor(Math.random() * 1e6).toString(36)
}

async function pageTextSnippet(page, length = 600) {
  try {
    const text = await page.evaluate(() => document.body?.innerText ?? '')
    return text.replace(/\s+/g, ' ').slice(0, length)
  } catch {
    return '<unavailable>'
  }
}

/** Records every request the browser makes to the CSS origin (must stay empty). */
function trackCssRequests(page, sink) {
  page.on('request', (request) => {
    try {
      const host = new URL(request.url()).hostname.toLowerCase()
      if (host === solidHost) {
        sink.push(`${request.method()} ${request.url()}`)
      }
    } catch {
      // ignore unparsable URLs
    }
  })
}

/** Records main-frame navigations so legacy redirect legs are provable-absent. */
function trackNavigations(page, sink) {
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      sink.push(frame.url())
    }
  })
}

async function readStoredSession(page) {
  const raw = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    SESSION_STORAGE_KEY,
  )
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function waitForAuthenticatedSurface(page, timeoutMs) {
  await page.waitForURL((url) => /\/(feed|onboarding|local)([/?#]|$)/.test(url.pathname), {
    timeout: timeoutMs,
  })
  // Onboarding is a transition surface: wait until the verified session
  // reaches the feed (the RouteGuard drives this once attestation verifies).
  await page.waitForURL((url) => /\/feed([/?#]|$)/.test(url.pathname), { timeout: timeoutMs })
}

function assertNoLegacyLegs(navigations, cssRequests) {
  for (const url of navigations) {
    if (/nz_oidc_bridge|nz_bridge_return|nz_stellar_token|[?&]code=|[?&]state=/.test(url)) {
      fail(`Legacy auth leg detected in navigation: ${url}`)
    }
    try {
      const host = new URL(url).hostname.toLowerCase()
      if (host === solidHost) {
        fail(`Browser navigated to the CSS origin: ${url}`)
      }
    } catch {
      // relative/opaque URLs are fine
    }
  }
  if (cssRequests.length > 0) {
    fail(`Browser issued ${cssRequests.length} request(s) to the CSS origin:\n  ${cssRequests.join('\n  ')}`)
  }
}

async function verifyLockboxOnChain(contractId) {
  const url = `https://api.stellar.expert/explorer/testnet/contract/${contractId}`
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (res.ok) {
        const body = await res.json()
        const entries = Number(body?.storage_entries ?? 0)
        if (entries >= 3) {
          log(`On-chain lockb0x ${contractId}: storage_entries=${entries} (deployed + initialized + attested)`)
          return
        }
        log(`On-chain lockb0x ${contractId}: storage_entries=${entries}; waiting for indexer...`)
      } else {
        log(`stellar.expert responded ${res.status}; retrying...`)
      }
    } catch (error) {
      log(`stellar.expert fetch failed (${String(error?.message || error)}); retrying...`)
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000))
  }
  fail(`On-chain lockb0x ${contractId} did not reach storage_entries>=3 via stellar.expert`)
}

async function main() {
  const handle = `qa${nowStamp()}${randomSuffix()}`
  const email = `${handle}@qa.nodezero.social`

  log(`Target: ${baseUrl}`)
  log(`CSS origin under embargo: ${solidHost}`)
  log(`New-user handle: ${handle}`)

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  const cssRequests = []
  const navigations = []
  trackCssRequests(page, cssRequests)
  trackNavigations(page, navigations)

  // ── Journey 1: new-user onboarding with inline session ────────────────────
  log('Journey 1: create node → inline session → authenticated feed')
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  await page.getByLabel('Node handle').first().fill(handle)
  await page.getByLabel('Notification email').first().fill(email)

  // The wallet must be provisioned before Create activates.
  await page.waitForFunction(
    () => {
      const allEls = Array.from(document.querySelectorAll('*'))
      return allEls.some((el) => (el.textContent || '').trim() === 'Create Your Node')
    },
    undefined,
    { timeout: 120_000 },
  )
  await page.getByText('Create Your Node', { exact: true }).first().click()

  await waitForAuthenticatedSurface(page, createTimeoutMs).catch(async (error) => {
    fail(`New-user journey did not reach the feed: ${String(error?.message || error)}\nPage: ${await pageTextSnippet(page)}`)
  })

  const session = await readStoredSession(page)
  if (!session?.accessToken || !session?.refreshToken) {
    fail('No NodeZero session found in storage after signup.')
  }
  if (!String(session.webId || '').includes(handle)) {
    fail(`Stored session webId does not match handle: ${session.webId}`)
  }
  const lockboxContractId = session?.lockbox?.userLockboxContractId
  if (!lockboxContractId) {
    fail('Session carries no on-chain lockb0x contract id.')
  }
  assertNoLegacyLegs(navigations, cssRequests)

  const inruptKeys = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((key) => key.toLowerCase().includes('solidclientauthn')),
  )
  if (inruptKeys.length > 0) {
    fail(`Legacy Inrupt session keys present: ${inruptKeys.join(', ')}`)
  }
  log(`Journey 1 PASS: webId=${session.webId}`)
  log(`  lockb0x=${lockboxContractId}`)

  // On-chain evidence for the anchor the session claims.
  await verifyLockboxOnChain(lockboxContractId)

  // ── Journey 2: returning-user one-tap sign-in ──────────────────────────────
  log('Journey 2: destroy session (keep wallet) → one-tap Stellar sign-in')
  await page.evaluate((key) => window.localStorage.removeItem(key), SESSION_STORAGE_KEY)
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  await page.waitForFunction(
    () => {
      const allEls = Array.from(document.querySelectorAll('*'))
      return allEls.some((el) => (el.textContent || '').trim() === 'Sign In')
    },
    undefined,
    { timeout: 120_000 },
  )
  await page.getByText('Sign In', { exact: true }).first().click()

  await waitForAuthenticatedSurface(page, sessionTimeoutMs).catch(async (error) => {
    fail(`Returning-user journey did not reach the feed: ${String(error?.message || error)}\nPage: ${await pageTextSnippet(page)}`)
  })

  const returningSession = await readStoredSession(page)
  if (!returningSession?.accessToken) {
    fail('No NodeZero session found in storage after returning sign-in.')
  }
  if (returningSession.webId !== session.webId) {
    fail(`Returning session webId mismatch: ${returningSession.webId} != ${session.webId}`)
  }
  assertNoLegacyLegs(navigations, cssRequests)
  log('Journey 2 PASS: returning sign-in restored the same identity with no CSS contact')

  // ── Journey 3: negative — destroyed session must fail closed ──────────────
  log('Journey 3: tampered session lands on sign-in (fail-closed)')
  await page.evaluate((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        accessToken: 'tampered.token.value',
        refreshToken: 'tampered-refresh',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        webId: 'https://example.invalid/evil#me',
        podUrl: 'https://example.invalid/evil/',
        lockbox: null,
        createdAt: new Date().toISOString(),
      }),
    )
  }, SESSION_STORAGE_KEY)

  await page.goto(`${baseUrl}/feed`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page
    .waitForURL((url) => url.pathname === '/' || url.pathname === '', { timeout: 60_000 })
    .catch(async () => {
      fail(`Tampered session was not rejected; current URL: ${page.url()}\nPage: ${await pageTextSnippet(page)}`)
    })

  const tamperedRemnant = await readStoredSession(page)
  if (tamperedRemnant) {
    fail('Tampered session record survived the fail-closed rejection.')
  }
  log('Journey 3 PASS: invariant enforced — no session, no app')

  await browser.close()
  log('ALL PASS: onboarding, returning sign-in, and fail-closed enforcement verified')
}

main().catch((error) => {
  fail(String(error?.stack || error))
})
