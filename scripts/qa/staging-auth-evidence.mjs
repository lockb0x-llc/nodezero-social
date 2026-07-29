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
 * verified directly through Soroban RPC. V3 requires the exact nine immutable
 * constructor fields and the expected factory/circuit bindings.
 *
 * Usage:
 *   node scripts/qa/staging-auth-evidence.mjs
 *   STAGING_BASE_URL=https://nodezero.social node scripts/qa/staging-auth-evidence.mjs
 */

import { chromium } from '@playwright/test'
import { Contract, rpc, scValToNative } from '@stellar/stellar-sdk'
import { appendFile } from 'node:fs/promises'

// Authentication starts at the public apex landing page. The authenticated
// application itself is exercised through its internal staging routes after
// the inline session is issued.
const baseUrl = (process.env.STAGING_BASE_URL || 'https://nodezero.social').replace(/\/$/, '')
const solidHost = (process.env.SOLID_HOST || 'solid.nodezero.social').toLowerCase()
const createTimeoutMs = Number(process.env.AUTH_E2E_CREATE_TIMEOUT_MS || 8 * 60 * 1000)
const sessionTimeoutMs = Number(process.env.AUTH_E2E_SESSION_TIMEOUT_MS || 4 * 60 * 1000)
const bridgeV3FactoryId =
  process.env.AUTH_E2E_V3_FACTORY_ID || 'CDFHCQA3YJCITWEMNLCSRGQVVFEXGTONWSQJTD5VIZO7YV4IOKZUPCGT'
const internalAppUrl = (
  process.env.NZ_INTERNAL_APP_URL || 'https://staging.nodezero.social'
).replace(/\/$/, '')
const provisionerUrl = (
  process.env.NZ_JSS_PROVISIONER_URL || 'https://api.nodezero.social'
).replace(/\/$/, '')
const expectCrossHostHandoff = /^(1|true|yes)$/i.test(
  process.env.NZ_EXPECT_INTERNAL_STAGING_HANDOFF ?? 'false'
)
const stellarRpcUrl = process.env.NZ_STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org'

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

async function publishOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) return
  await appendFile(outputPath, `${name}=${value}\n`, 'utf8')
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

function trackFriendbotRequests(page, sink) {
  page.on('request', (request) => {
    try {
      if (new URL(request.url()).hostname.toLowerCase() === 'friendbot.stellar.org') {
        sink.push(`${request.method()} ${request.url()}`)
      }
    } catch {
      // ignore unparsable URLs
    }
  })
}

async function readStoredSession(page) {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function waitForStoredSession(page, timeoutMs) {
  await page.waitForFunction(
    (key) => {
      const raw = window.localStorage.getItem(key)
      if (!raw) return false
      try {
        const session = JSON.parse(raw)
        return Boolean(
          session?.accessToken && session?.refreshToken && session?.webId && session?.podUrl
        )
      } catch {
        return false
      }
    },
    SESSION_STORAGE_KEY,
    { timeout: timeoutMs }
  )
}

async function waitForAuthenticatedSurface(page, timeoutMs) {
  await page.waitForURL((url) => /\/(feed|onboarding|local)([/?#]|$)/.test(url.pathname), {
    timeout: timeoutMs,
  })
  await waitForStoredSession(page, timeoutMs)
  // Staging can briefly land on /feed before the asynchronous browser-session
  // bootstrap persists local state. The RouteGuard then uses /onboarding while
  // the V3 attestation is checked and returns to /feed once it is verified.
  await page.waitForFunction(
    () =>
      window.location.pathname === '/feed' &&
      !document.body.innerText.includes('Finalizing your onboarding'),
    undefined,
    { timeout: timeoutMs }
  )
}

async function revokeBrowserSession(page, session) {
  const status = await page.evaluate(
    async ({ apiUrl, refreshToken, webId }) => {
      const response = await fetch(`${apiUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refreshToken, webId }),
      })
      return response.status
    },
    {
      apiUrl: provisionerUrl,
      refreshToken: session.refreshToken,
      webId: session.webId,
    }
  )
  if (status !== 200)
    fail(`Could not revoke browser session before returning sign-in: HTTP ${status}.`)
  await page.evaluate((key) => window.localStorage.removeItem(key), SESSION_STORAGE_KEY)
}

function assertExpectedHandoff(page, stage) {
  if (!expectCrossHostHandoff) return
  const current = new URL(page.url())
  if (current.origin !== internalAppUrl || !/^\/feed\/?$/.test(current.pathname)) {
    fail(`${stage} did not hand off to the internal staging feed: ${page.url()}`)
  }
}

async function maybeSelectAccountForReturningSignIn(page, expectedWebId) {
  const modalTitle = page.getByText('Choose an account', { exact: true }).first()
  const isVisible = await modalTitle.isVisible({ timeout: 5_000 }).catch(() => false)
  if (!isVisible) return false

  log('Returning sign-in surfaced internal account chooser; selecting the expected WebID.')
  const matchingOption = page.getByText(expectedWebId, { exact: true }).first()
  const hasMatch = await matchingOption.isVisible({ timeout: 5_000 }).catch(() => false)
  if (!hasMatch) {
    fail(`Account chooser did not contain expected WebID: ${expectedWebId}`)
  }
  await matchingOption.click()
  await page.getByText('Continue', { exact: true }).first().click()
  return true
}

async function simulateLegacyWalletCutover(context, page) {
  const walletFrame = page.frames().find((frame) => frame.url().startsWith('https://wallet.nodezero.social/'))
  if (!walletFrame) fail('Wallet broker frame is unavailable for legacy migration evidence.')
  const legacy = await walletFrame.evaluate(() => {
    const prefix = 'nodezero.embedded-wallet.'
    const indexKey = `${prefix}nodezero.stellar.keyring.index.v1`
    const activeKey = `${prefix}nodezero.stellar.active-key-id.v1`
    const index = JSON.parse(localStorage.getItem(indexKey) || '{}')
    const keyId = localStorage.getItem(activeKey) || index.keyIds?.[0]
    const secretKey = `${prefix}nodezero.stellar.secret.${keyId}`
    const metaKey = `${prefix}nodezero.stellar.identity.meta.${keyId}`
    const secret = localStorage.getItem(secretKey)
    const meta = localStorage.getItem(metaKey)
    if (!keyId || !secret) throw new Error('Active broker identity is unavailable.')
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix)) localStorage.removeItem(key)
    }
    return { keyId, secret, meta }
  })

  const stagingSeed = await context.newPage()
  await stagingSeed.goto(`${internalAppUrl}/`, { waitUntil: 'domcontentloaded' })
  await stagingSeed.evaluate(({ keyId, secret, meta }) => {
    const prefix = 'nodezero.embedded-wallet.'
    localStorage.setItem(
      `${prefix}nodezero.stellar.keyring.index.v1`,
      JSON.stringify({ version: 1, keyIds: [keyId] }),
    )
    localStorage.setItem(`${prefix}nodezero.stellar.active-key-id.v1`, keyId)
    localStorage.setItem(`${prefix}nodezero.stellar.secret.${keyId}`, secret)
    localStorage.setItem(
      `${prefix}nodezero.stellar.identity.meta.${keyId}`,
      meta || JSON.stringify({ keyId, label: 'Legacy identity', createdAt: new Date().toISOString(), lastUsedAt: null }),
    )
  }, legacy)
  await stagingSeed.close()
  return legacy.keyId
}

async function assertLegacyWalletMigrated(context, page, legacyKeyId) {
  const walletFrame = page.frames().find((frame) => frame.url().startsWith('https://wallet.nodezero.social/'))
  if (!walletFrame) fail('Wallet broker frame is unavailable after legacy migration.')
  const brokerState = await walletFrame.evaluate(() => {
    const prefix = 'nodezero.embedded-wallet.'
    const raw = localStorage.getItem(`${prefix}nodezero.stellar.keyring.index.v1`)
    const index = raw ? JSON.parse(raw) : null
    return { count: Array.isArray(index?.keyIds) ? index.keyIds.length : 0 }
  })
  if (brokerState.count !== 1) fail(`Legacy migration restored ${brokerState.count} broker identities; expected 1.`)

  const stagingCheck = await context.newPage()
  await stagingCheck.goto(`${internalAppUrl}/`, { waitUntil: 'domcontentloaded' })
  const legacySecretPresent = await stagingCheck.evaluate((keyId) =>
    localStorage.getItem(`nodezero.embedded-wallet.nodezero.stellar.secret.${keyId}`) !== null,
    legacyKeyId,
  )
  await stagingCheck.close()
  if (legacySecretPresent) fail('Legacy staging identity secret remained after verified broker migration.')
  log('Legacy wallet migration PASS: staging-origin key restored to broker and plaintext source removed')
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
    fail(
      `Browser issued ${cssRequests.length} request(s) to the CSS origin:\n  ${cssRequests.join('\n  ')}`
    )
  }
}

function assertNoFriendbotRequests(friendbotRequests) {
  if (friendbotRequests.length > 0) {
    fail(
      `Browser issued ${friendbotRequests.length} Friendbot request(s):\n  ${friendbotRequests.join('\n  ')}`
    )
  }
}

async function verifyLockboxOnChain(contractId, factoryContractId) {
  const isBridgeV3 = factoryContractId === bridgeV3FactoryId
  const server = new rpc.Server(stellarRpcUrl)
  const expectedV3Keys = [
    'AccountCommitment',
    'Ciphertext',
    'CiphertextHash',
    'CircuitVersion',
    'ClaimHash',
    'Factory',
    'Operator',
    'PodBinding',
    'ProofHash',
  ]
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await server.getLedgerEntries(new Contract(contractId).getFootprint())
      const entry = response.entries[0]
      const storage = entry?.val?.contractData?.().val().instance().storage()
      const decoded = new Map()
      for (const storageEntry of Array.from(storage ?? [])) {
        const key = scValToNative(storageEntry.key())
        if (!Array.isArray(key) || key.length !== 1 || typeof key[0] !== 'string') {
          throw new Error('lockb0x contains an invalid instance-storage key')
        }
        decoded.set(key[0], scValToNative(storageEntry.val()))
      }
      const keys = [...decoded.keys()].sort()
      if (isBridgeV3) {
        if (
          keys.length !== expectedV3Keys.length ||
          keys.some((key, index) => key !== expectedV3Keys[index])
        ) {
          throw new Error(`V3 storage keys are incomplete or unexpected: ${keys.join(',')}`)
        }
        if (decoded.get('Factory') !== factoryContractId) {
          throw new Error(`V3 factory binding mismatch: ${String(decoded.get('Factory'))}`)
        }
        if (Number(decoded.get('CircuitVersion')) !== 3) {
          throw new Error(`V3 circuit version mismatch: ${String(decoded.get('CircuitVersion'))}`)
        }
      } else if (keys.length < 3) {
        throw new Error(`legacy lockb0x has only ${keys.length} instance-storage entries`)
      }
      log(`On-chain lockb0x ${contractId}: direct RPC verified ${keys.length} instance-storage entries`)
      return
    } catch (error) {
      log(`Soroban RPC verification attempt ${attempt}/5 failed (${String(error?.message || error)})`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  fail(`On-chain lockb0x ${contractId} did not expose complete instance state via Soroban RPC`)
}

async function readPodResourceThroughProxy(page, session, resourceUrl) {
  return page.evaluate(async ({ accessToken, url, apiBase }) => {
    const parsed = new URL(url)
    const proxyUrl = `${apiBase}/v1/pod-proxy${parsed.pathname}${parsed.search}`
    const response = await fetch(proxyUrl, {
      headers: {
        accept: 'application/ld+json, application/json, text/turtle',
        authorization: `Bearer ${accessToken}`,
      },
    })
    return {
      status: response.status,
      body: await response.text(),
    }
  }, { accessToken: session.accessToken, url: resourceUrl, apiBase: provisionerUrl })
}

async function verifyDocustreamPersistence(page, session) {
  const sourceUrl = 'https://hnrss.org/frontpage'
  const podRoot = String(session.podUrl || '').replace(/\/$/, '')
  const registryUrl = `${podRoot}/public/docustream-sources.jsonld`
  const profileUrl = String(session.webId || '').split('#')[0]

  log('Journey 3: DocuStream source → Pod registry + WebID profile links')
  await page.goto(`${internalAppUrl}/docustream`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.getByTestId('docustream-sources-open').waitFor({ state: 'visible', timeout: 120_000 })
  await page.getByTestId('docustream-sources-open').click()
  await page.getByTestId('docustream-source-url-input').fill(sourceUrl)
  await page.getByTestId('docustream-source-add').click()

  const sourceRow = page.locator('[data-testid^="docustream-source-rss_"]').first()
  await sourceRow.waitFor({ state: 'visible', timeout: 120_000 })

  const registry = await readPodResourceThroughProxy(page, session, registryUrl)
  if (registry.status !== 200 || !registry.body.includes(sourceUrl)) {
    fail(`DocuStream registry did not persist source. HTTP ${registry.status}: ${registry.body.slice(0, 300)}`)
  }
  const profile = await readPodResourceThroughProxy(page, session, profileUrl)
  for (const marker of ['docustreamSourceRegistry', 'docustreamContainer', 'docustreamSource', sourceUrl]) {
    if (profile.status !== 200 || !profile.body.includes(marker)) {
      fail(`WebID profile is missing DocuStream marker '${marker}'. HTTP ${profile.status}`)
    }
  }

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('docustream-sources-open').waitFor({ state: 'visible', timeout: 120_000 })
  await page.getByTestId('docustream-sources-open').click()
  await page.getByText(sourceUrl, { exact: true }).waitFor({ state: 'visible', timeout: 60_000 })

  const remove = page.locator('[data-testid^="docustream-source-remove-rss_"]').first()
  await remove.click()
  await page.getByText(sourceUrl, { exact: true }).waitFor({ state: 'detached', timeout: 60_000 })

  const registryAfter = await readPodResourceThroughProxy(page, session, registryUrl)
  if (registryAfter.status !== 200 || registryAfter.body.includes(sourceUrl)) {
    fail(`DocuStream registry removal did not persist. HTTP ${registryAfter.status}`)
  }
  const profileAfter = await readPodResourceThroughProxy(page, session, profileUrl)
  if (profileAfter.status !== 200 || profileAfter.body.includes(sourceUrl)) {
    fail(`WebID profile retained removed DocuStream source. HTTP ${profileAfter.status}`)
  }
  log('Journey 3 PASS: source persisted to Pod + profile, survived reload, and removed cleanly')
}

async function main() {
  const verifyOnlyContractId = (process.env.AUTH_E2E_VERIFY_LOCKBOX_ID || '').trim()
  if (verifyOnlyContractId) {
    await verifyLockboxOnChain(
      verifyOnlyContractId,
      (process.env.AUTH_E2E_VERIFY_FACTORY_ID || bridgeV3FactoryId).trim(),
    )
    log(`Direct lockb0x verification PASS: ${verifyOnlyContractId}`)
    return
  }

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
  const friendbotRequests = []
  trackCssRequests(page, cssRequests)
  trackNavigations(page, navigations)
  trackFriendbotRequests(page, friendbotRequests)

  // ── Journey 1: new-user onboarding with inline session ────────────────────
  log('Journey 1: create node → inline session → authenticated feed')
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  await page.getByLabel('Node handle').first().waitFor({ state: 'visible', timeout: 180_000 })
  await page.getByLabel('Node handle').first().fill(handle)
  await page.getByLabel('Notification email').first().fill(email)

  // The wallet must be provisioned before Create activates.
  await page.waitForFunction(
    () => {
      const allEls = Array.from(document.querySelectorAll('*'))
      return allEls.some((el) => (el.textContent || '').trim() === 'Create Your Node')
    },
    undefined,
    { timeout: 120_000 }
  )
  await page.getByText('Create Your Node', { exact: true }).first().click()

  await waitForAuthenticatedSurface(page, createTimeoutMs).catch(async (error) => {
    fail(
      `New-user journey did not reach the feed: ${String(error?.message || error)}\nPage: ${await pageTextSnippet(page)}`
    )
  })
  assertExpectedHandoff(page, 'New-user onboarding')

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
  assertNoFriendbotRequests(friendbotRequests)

  const inruptKeys = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((key) => key.toLowerCase().includes('solidclientauthn'))
  )
  if (inruptKeys.length > 0) {
    fail(`Legacy Inrupt session keys present: ${inruptKeys.join(', ')}`)
  }
  log(`Journey 1 PASS: webId=${session.webId}`)
  log(`  lockb0x=${lockboxContractId}`)
  await publishOutput('lockbox_contract_id', lockboxContractId)

  // On-chain evidence for the anchor the session claims.
  await verifyLockboxOnChain(lockboxContractId, session?.lockbox?.factoryContractId)

  // ── Journey 2: returning-user one-tap sign-in ──────────────────────────────
  log('Journey 2: migrate legacy staging wallet → one-tap Stellar sign-in')
  const legacyKeyId = await simulateLegacyWalletCutover(context, page)
  await revokeBrowserSession(page, session)
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await assertLegacyWalletMigrated(context, page, legacyKeyId)

  await page.waitForFunction(
    () => {
      const allEls = Array.from(document.querySelectorAll('*'))
      return allEls.some((el) => (el.textContent || '').trim() === 'Sign In')
    },
    undefined,
    { timeout: 120_000 }
  )
  await page.getByText('Sign In', { exact: true }).first().click()
  await maybeSelectAccountForReturningSignIn(page, session.webId)

  await waitForAuthenticatedSurface(page, sessionTimeoutMs).catch(async (error) => {
    fail(
      `Returning-user journey did not reach the feed: ${String(error?.message || error)}\nPage: ${await pageTextSnippet(page)}`
    )
  })
  assertExpectedHandoff(page, 'Returning user sign-in')

  const returningSession = await readStoredSession(page)
  if (!returningSession?.accessToken) {
    fail('No NodeZero session found in storage after returning sign-in.')
  }
  if (returningSession.webId !== session.webId) {
    fail(`Returning session webId mismatch: ${returningSession.webId} != ${session.webId}`)
  }
  assertNoLegacyLegs(navigations, cssRequests)
  assertNoFriendbotRequests(friendbotRequests)
  log('Journey 2 PASS: returning sign-in restored the same identity with no CSS contact')

  await verifyDocustreamPersistence(page, returningSession)

  // ── Journey 4: negative — destroyed session must fail closed ──────────────
  log('Journey 4: tampered session lands on sign-in (fail-closed)')
  await revokeBrowserSession(page, returningSession)
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
      })
    )
  }, SESSION_STORAGE_KEY)

  await page.goto(`${baseUrl}/feed`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page
    .waitForURL((url) => url.pathname === '/' || url.pathname === '', { timeout: 60_000 })
    .catch(async () => {
      fail(
        `Tampered session was not rejected; current URL: ${page.url()}\nPage: ${await pageTextSnippet(page)}`
      )
    })

  const tamperedRemnant = await readStoredSession(page)
  if (tamperedRemnant) {
    fail('Tampered session record survived the fail-closed rejection.')
  }
  log('Journey 4 PASS: invariant enforced — no session, no app')

  await browser.close()
  log('ALL PASS: onboarding, returning sign-in, DocuStream persistence, and fail-closed enforcement verified')
}

main().catch((error) => {
  fail(String(error?.stack || error))
})
