#!/usr/bin/env node

/**
 * Headed, evidence-producing apex-to-staging onboarding verification.
 *
 * Preconditions:
 * - nodezero.social is the public sign-in host.
 * - staging.nodezero.social is the internal Testnet application host.
 * - api.nodezero.social and wallet.nodezero.social have valid TLS bindings.
 * - Browser-session and wallet-broker flags are enabled in the deployed app.
 *
 * The output contains public identifiers only. It never writes Stellar
 * secrets, NodeZero access/refresh tokens, cookies, client credentials, or
 * CSS account passwords.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const apexUrl = (process.env.NZ_APEX_URL ?? 'https://nodezero.social').replace(/\/$/, '')
const stagingUrl = (process.env.NZ_STAGING_URL ?? 'https://staging.nodezero.social').replace(/\/$/, '')
const evidenceDir = process.env.NZ_ONBOARDING_EVIDENCE_DIR ?? 'docs/screenshots/onboarding'
const headless = /^(1|true|yes)$/i.test(process.env.NZ_E2E_HEADLESS ?? 'false')
const createTimeoutMs = Number(process.env.NZ_E2E_CREATE_TIMEOUT_MS ?? 8 * 60_000)
const sessionTimeoutMs = Number(process.env.NZ_E2E_SESSION_TIMEOUT_MS ?? 4 * 60_000)
const sessionStorageKey = 'nz.session.v2'
const treasuryPublicKey = 'GAUMNOPBK5WYUGIV2VH7JXMHACFSB4QV4HCJM5LB7ERUYKUN6UEZGEYI'

function stamp() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

function log(message) {
  console.log(`[apex-staging-evidence] ${message}`)
}

function fail(message) {
  throw new Error(message)
}

function parseJwtClaims(token) {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

async function readSession(page) {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), sessionStorageKey)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function waitForStagingFeed(page, timeoutMs) {
  await page.waitForURL((url) => {
    return url.origin === stagingUrl && /\/feed([/?#]|$)/.test(url.pathname)
  }, { timeout: timeoutMs })
}

async function waitForSession(page, timeoutMs) {
  await page.waitForFunction(
    (key) => {
      const raw = window.localStorage.getItem(key)
      if (!raw) return false
      try {
        const session = JSON.parse(raw)
        return Boolean(session?.accessToken && session?.refreshToken && session?.webId && session?.podUrl)
      } catch {
        return false
      }
    },
    sessionStorageKey,
    { timeout: timeoutMs },
  )
}

async function waitForVerifiedStagingFeed(page, timeoutMs) {
  await page.waitForFunction(
    () =>
      window.location.pathname === '/feed' &&
      !document.body.innerText.includes('Finalizing your onboarding') &&
      document.body.innerText.toLowerCase().includes('nodezero session'),
    undefined,
    { timeout: timeoutMs },
  )
}

async function verifyTreasuryCreation(publicKey) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const response = await fetch(
      `https://horizon-testnet.stellar.org/accounts/${encodeURIComponent(publicKey)}/operations?order=asc&limit=20`,
    )
    if (response.ok) {
      const body = await response.json()
      const operation = body?._embedded?.records?.find((item) => item.type === 'create_account')
      if (operation) {
        if (operation.source_account !== treasuryPublicKey) {
          fail(`Stellar account was created by ${operation.source_account}, not Treasury ${treasuryPublicKey}.`)
        }
        return { transactionHash: operation.transaction_hash, sourceAccount: operation.source_account }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  fail(`No indexed Testnet CreateAccount operation found for ${publicKey}.`)
}

async function verifyLockbox(contractId) {
  const response = await fetch(`https://api.stellar.expert/explorer/testnet/contract/${contractId}`)
  if (!response.ok) fail(`stellar.expert could not read lockb0x ${contractId}: ${response.status}`)
  const body = await response.json()
  if (body?.contract !== contractId) fail(`stellar.expert returned unexpected lockb0x data for ${contractId}.`)
  return {
    contractId: body.contract,
    creator: body.creator ?? null,
    wasm: body.wasm ?? null,
    storageEntries: Number(body.storage_entries ?? 0),
  }
}

async function main() {
  const runStamp = stamp()
  const handle = `e2e${runStamp}`
  const email = `hotkane+${runStamp}@gmail.com`
  await mkdir(evidenceDir, { recursive: true })

  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } })
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  const page = await context.newPage()
  const cssRequests = []
  const friendbotRequests = []
  const mainFrameNavigations = []

  page.on('request', (request) => {
    try {
      const hostname = new URL(request.url()).hostname.toLowerCase()
      if (hostname === 'solid.nodezero.social') cssRequests.push(`${request.method()} ${request.url()}`)
      if (hostname === 'friendbot.stellar.org') friendbotRequests.push(`${request.method()} ${request.url()}`)
    } catch {
      // Ignore non-URL requests.
    }
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations.push(frame.url())
  })

  try {
    log(`Opening public apex: ${apexUrl}`)
    await page.goto(`${apexUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.getByLabel('Node handle').first().waitFor({ state: 'visible', timeout: 180_000 })
    await page.screenshot({ path: join(evidenceDir, `${runStamp}-01-apex-create.png`), fullPage: true })

    await page.getByLabel('Node handle').first().fill(handle)
    await page.getByLabel('Notification email').first().fill(email)
    await page.getByText('Create Your Node', { exact: true }).first().click()
    await waitForStagingFeed(page, createTimeoutMs)
    await waitForSession(page, createTimeoutMs)
    await waitForVerifiedStagingFeed(page, createTimeoutMs)
    await page.screenshot({ path: join(evidenceDir, `${runStamp}-02-staging-verified-feed.png`), fullPage: true })

    const createdSession = await readSession(page)
    if (!createdSession?.accessToken || !createdSession?.webId || !createdSession?.lockbox?.userLockboxContractId) {
      fail('Staging did not bootstrap a complete local NodeZero session from the apex handoff.')
    }
    const claims = parseJwtClaims(createdSession.accessToken)
    const stellarPublicKey = claims?.spk
    if (typeof stellarPublicKey !== 'string' || !stellarPublicKey.startsWith('G')) {
      fail('Staging session does not carry a public Stellar identity claim.')
    }

    const treasuryEvidence = await verifyTreasuryCreation(stellarPublicKey)
    const lockboxEvidence = await verifyLockbox(createdSession.lockbox.userLockboxContractId)

    await page.goto(`${stagingUrl}/settings`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.getByText('Sign Out', { exact: false }).first().click()
    await page.waitForURL((url) => url.origin === stagingUrl && url.pathname === '/', { timeout: 60_000 })

    log('Starting returning user sign-in at apex.')
    await page.goto(`${apexUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.getByText('Sign In', { exact: true }).first().click()
    await waitForStagingFeed(page, sessionTimeoutMs)
    await waitForSession(page, sessionTimeoutMs)
    await waitForVerifiedStagingFeed(page, sessionTimeoutMs)
    await page.screenshot({ path: join(evidenceDir, `${runStamp}-03-apex-returning-signin-staging-feed.png`), fullPage: true })

    const returningSession = await readSession(page)
    if (returningSession?.webId !== createdSession.webId) {
      fail(`Returning staging session did not restore the same WebID.`)
    }
    if (returningSession?.lockbox?.userLockboxContractId !== createdSession.lockbox.userLockboxContractId) {
      fail('Returning staging session did not restore the same lockb0x.')
    }
    if (cssRequests.length > 0) fail(`Browser contacted CSS:\n${cssRequests.join('\n')}`)
    if (friendbotRequests.length > 0) fail(`Browser contacted Friendbot:\n${friendbotRequests.join('\n')}`)
    if (mainFrameNavigations.some((url) => /solid\.nodezero\.social|nz_oidc_bridge|nz_bridge_return|[?&](code|state)=/.test(url))) {
      fail('Legacy CSS/OIDC browser navigation was observed.')
    }

    const evidence = {
      schemaVersion: 1,
      generatedAtUtc: new Date().toISOString(),
      publicApex: apexUrl,
      internalStaging: stagingUrl,
      handle,
      email,
      webId: createdSession.webId,
      stellarPublicKey,
      lockbox: lockboxEvidence,
      treasuryCreateAccount: treasuryEvidence,
      assertions: {
        apexToStagingHandoff: true,
        returningApexToStagingHandoff: true,
        sameWebId: true,
        sameLockbox: true,
        zeroCssBrowserRequests: true,
        zeroFriendbotBrowserRequests: true,
      },
      screenshots: [
        `${runStamp}-01-apex-create.png`,
        `${runStamp}-02-staging-verified-feed.png`,
        `${runStamp}-03-apex-returning-signin-staging-feed.png`,
      ],
      trace: `${runStamp}-playwright-trace.zip`,
    }
    await writeFile(join(evidenceDir, `${runStamp}-evidence.json`), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    await context.tracing.stop({ path: join(evidenceDir, `${runStamp}-playwright-trace.zip`) })
    log(`PASS: wrote sanitized evidence to ${evidenceDir}`)
  } finally {
    await context.tracing.stop().catch(() => undefined)
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`[apex-staging-evidence] FAIL: ${String(error?.stack || error)}`)
  process.exit(1)
})