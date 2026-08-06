#!/usr/bin/env node

import { chromium } from '@playwright/test'
import { Keypair, Networks } from '@stellar/stellar-sdk'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const SESSION_COOKIE = '__Host-nz_browser_session'
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/
const STELLAR_SECRET_KEY_PATTERN = /^S[A-Z2-7]{55}$/
const SESSION_COOKIE_DOMAINS = new Set([
  'api.nodezero.social',
  'nodezero-social-staging-testnet-provisioner.azurewebsites.net',
])
const REQUIRED_SECRET_NAMES = [
  'JSS_Q_COHORT_KEY',
  'JSS_Q_COHORT_HASHES',
  'NZ_DIRECTORY_ACCOUNT_A_RECOVERY_BUNDLE',
  'NZ_DIRECTORY_ACCOUNT_B_RECOVERY_BUNDLE',
  'NZ_DIRECTORY_NON_COHORT_RECOVERY_BUNDLE',
]

export function assertBootstrapTarget({ baseUrl, repository, environment, solidHost }) {
  if (baseUrl !== 'https://staging.nodezero.social') {
    throw new Error(`Refusing non-staging base URL: ${baseUrl}`)
  }
  if (repository !== 'lockb0x-llc/nodezero-social') {
    throw new Error(`Refusing unexpected GitHub repository: ${repository}`)
  }
  if (environment !== 'staging-testnet') {
    throw new Error(`Refusing non-staging GitHub environment: ${environment}`)
  }
  if (solidHost !== 'solid.nodezero.social') {
    throw new Error(`Refusing unexpected Solid host: ${solidHost}`)
  }
}

export function isCssHost(hostname, solidHost) {
  const normalized = hostname.toLowerCase()
  return normalized === solidHost || normalized.endsWith(`.${solidHost}`)
}

export function githubSecretArgs(repository, environment, name) {
  return ['secret', 'set', name, '--repo', repository, '--env', environment]
}

export function validateFreshBrowserSession(cookies) {
  if (!Array.isArray(cookies)) throw new Error('Browser cookies are unavailable.')
  const sessions = cookies.filter((cookie) => cookie?.name === SESSION_COOKIE)
  const session = sessions[0]
  if (
    sessions.length !== 1 ||
    !session ||
    typeof session.value !== 'string' ||
    !session.value ||
    session.httpOnly !== true ||
    session.secure !== true ||
    session.path !== '/' ||
    !SESSION_COOKIE_DOMAINS.has(session.domain) ||
    !Number.isFinite(session.expires) ||
    session.expires < Date.now() / 1000 + 24 * 60 * 60
  ) {
    throw new Error('Fresh sign-in did not mint one secure opaque NodeZero browser session.')
  }
  return session.value
}

export function validateRecoveryBundle(raw, expectedWebId) {
  let bundle
  try {
    bundle = JSON.parse(raw)
  } catch {
    throw new Error('Recovery bundle is not valid JSON.')
  }
  if (
    bundle?.bundleVersion !== 1 ||
    bundle.envProfile !== 'staging-testnet' ||
    bundle.stellarNetworkPassphrase !== Networks.TESTNET ||
    bundle.webId !== expectedWebId
  ) {
    throw new Error('Recovery bundle is not bound to the expected staging account.')
  }
  const publicKey = bundle.wallet?.publicKey
  const secretKey = bundle.wallet?.secretKey
  if (
    typeof publicKey !== 'string' ||
    !STELLAR_PUBLIC_KEY_PATTERN.test(publicKey) ||
    typeof secretKey !== 'string' ||
    !STELLAR_SECRET_KEY_PATTERN.test(secretKey)
  ) {
    throw new Error('Recovery bundle contains invalid Stellar key material.')
  }
  if (Keypair.fromSecret(secretKey).publicKey() !== publicKey) {
    throw new Error('Recovery bundle Stellar keys do not match.')
  }
  return { webId: bundle.webId, publicKey }
}

export function deriveCohort(webIds, key = randomBytes(32).toString('base64url')) {
  if (!Array.isArray(webIds) || webIds.length !== 3 || new Set(webIds).size !== 3) {
    throw new Error('Directory cohort bootstrap requires three distinct WebIDs.')
  }
  if (typeof key !== 'string' || key.length < 32) {
    throw new Error('Directory cohort HMAC key is too short.')
  }
  const hashes = webIds
    .slice(0, 2)
    .map((webId) => createHmac('sha256', key).update(webId).digest('hex'))
  const controlHash = createHmac('sha256', key).update(webIds[2]).digest('hex')
  if (new Set(hashes).size !== 2 || hashes.includes(controlHash)) {
    throw new Error('Directory cohort identities are not independently scoped.')
  }
  return { key, hashes }
}

function log(message) {
  console.log(`[directory-cohort-bootstrap] ${message}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    stdio: options.input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} ${args[0] ?? ''} exited with ${result.status}.`)
  }
  return result.stdout
}

export function captureRequestAudit(request) {
  let hostname = ''
  let baseSurfaces = []
  try {
    const url = request.url()
    hostname = new URL(url).hostname
    baseSurfaces = [url, request.postData() ?? '']
    return Promise.resolve(request.allHeaders())
      .then((headers) => ({
        auditFailed: false,
        hostname,
        hasAuthorization: Boolean(headers.authorization),
        surfaces: [...baseSurfaces, ...Object.values(headers)],
      }))
      .catch(() => ({
        auditFailed: true,
        hostname,
        hasAuthorization: false,
        surfaces: baseSurfaces,
      }))
  } catch {
    return Promise.resolve({
      auditFailed: true,
      hostname,
      hasAuthorization: false,
      surfaces: baseSurfaces,
    })
  }
}

async function waitForAuthenticatedSurface(page, timeoutMs) {
  await page.waitForURL((url) => /\/(feed|onboarding|local)([/?#]|$)/.test(url.pathname), {
    timeout: timeoutMs,
  })
  await page.waitForFunction(
    () =>
      window.location.pathname === '/feed' &&
      !document.body.innerText.includes('Finalizing your onboarding'),
    undefined,
    { timeout: timeoutMs }
  )
}

async function installRecoveryCapture(context) {
  await context.addInitScript(() => {
    const capture = { json: null, error: null }
    Object.defineProperty(globalThis, '__nzDirectoryRecoveryCapture', {
      configurable: false,
      value: capture,
    })
    const createObjectUrl = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type === 'application/json') {
        void blob
          .text()
          .then((json) => {
            const candidate = JSON.parse(json)
            if (
              candidate?.bundleVersion === 1 &&
              typeof candidate.wallet?.publicKey === 'string' &&
              typeof candidate.wallet?.secretKey === 'string'
            ) {
              capture.json = json
            }
          })
          .catch(() => {
            capture.error = 'capture_failed'
          })
      }
      return createObjectUrl(blob)
    }
    const anchorClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (...args) {
      if (this.download.startsWith('nodezero-recovery-') && this.href.startsWith('blob:')) return
      return anchorClick.apply(this, args)
    }
  })
}

async function captureRecoveryBundle(page, baseUrl, timeoutMs) {
  await page.goto(`${baseUrl}/settings`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const exportButton = page.getByRole('button', { name: 'Export recovery bundle' })
  await exportButton.waitFor({ state: 'visible', timeout: timeoutMs })
  const dialogPromise = page.waitForEvent('dialog', { timeout: timeoutMs })
  await exportButton.click()
  const dialog = await dialogPromise
  const expectedWarning =
    dialog.type() === 'confirm' && dialog.message().includes('private wallet key')
  await dialog.accept()
  if (!expectedWarning) throw new Error('Recovery export did not present its private-key warning.')
  await page.waitForFunction(
    () => {
      const capture = globalThis.__nzDirectoryRecoveryCapture
      return typeof capture?.json === 'string' || capture?.error === 'capture_failed'
    },
    undefined,
    { timeout: timeoutMs }
  )
  return page.evaluate(() => {
    const capture = globalThis.__nzDirectoryRecoveryCapture
    if (capture?.error || typeof capture?.json !== 'string') {
      throw new Error('Recovery bundle capture failed.')
    }
    const json = capture.json
    capture.json = null
    return json
  })
}

async function importRecoveryBundle(page, baseUrl, recoveryBundle, timeoutMs) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const restoreButton = page.getByRole('button', {
    name: 'Restore identity from recovery bundle',
  })
  await restoreButton.waitFor({ state: 'visible', timeout: timeoutMs })
  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: timeoutMs })
  await restoreButton.click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: 'nodezero-recovery.json',
    mimeType: 'application/json',
    buffer: Buffer.from(recoveryBundle),
  })
  await page
    .getByText('Identity restored securely. Tap Sign In to continue.')
    .waitFor({ state: 'visible', timeout: timeoutMs })
}

async function assertEncryptedWallet(page, recoverySecret) {
  const result = await page.evaluate(async (secret) => {
    const databaseInfo = (await indexedDB.databases()).find(
      (database) => database.name === 'nodezero-wallet-staging-testnet-v1'
    )
    if (!databaseInfo?.name) return { databasePresent: false }
    const openRequest = indexedDB.open(databaseInfo.name)
    const database = await new Promise((resolve, reject) => {
      openRequest.onsuccess = () => resolve(openRequest.result)
      openRequest.onerror = () => reject(openRequest.error)
    })
    try {
      if (
        !database.objectStoreNames.contains('keys') ||
        !database.objectStoreNames.contains('records')
      ) {
        return { databasePresent: true, storesPresent: false }
      }
      const keyTransaction = database.transaction('keys', 'readonly')
      const keyRequest = keyTransaction.objectStore('keys').get('wallet-records-v1')
      const keyRecord = await new Promise((resolve, reject) => {
        keyRequest.onsuccess = () => resolve(keyRequest.result)
        keyRequest.onerror = () => reject(keyRequest.error)
      })
      const recordsTransaction = database.transaction('records', 'readonly')
      const recordsRequest = recordsTransaction.objectStore('records').getAll()
      const records = await new Promise((resolve, reject) => {
        recordsRequest.onsuccess = () => resolve(recordsRequest.result)
        recordsRequest.onerror = () => reject(recordsRequest.error)
      })
      let exportRejected = false
      if (keyRecord?.key instanceof CryptoKey) {
        try {
          await crypto.subtle.exportKey('raw', keyRecord.key)
        } catch {
          exportRejected = true
        }
      }
      return {
        databasePresent: true,
        storesPresent: true,
        keyIsCryptoKey: keyRecord?.key instanceof CryptoKey,
        keyExtractable: keyRecord?.key?.extractable,
        keyAlgorithm: keyRecord?.key?.algorithm?.name,
        keyUsages: [...(keyRecord?.key?.usages ?? [])].sort(),
        exportRejected,
        plaintextAbsent: !JSON.stringify(records).includes(secret),
      }
    } finally {
      database.close()
    }
  }, recoverySecret)
  if (
    result.databasePresent !== true ||
    result.storesPresent !== true ||
    result.keyIsCryptoKey !== true ||
    result.keyExtractable !== false ||
    result.keyAlgorithm !== 'AES-GCM' ||
    result.keyUsages?.join(',') !== 'decrypt,encrypt' ||
    result.exportRejected !== true ||
    result.plaintextAbsent !== true
  ) {
    throw new Error('Recovery import did not produce a non-extractable encrypted wallet.')
  }
}

async function collectRequestAudits(audits) {
  const records = []
  let audited = 0
  while (audited < audits.length) {
    const pending = audits.slice(audited)
    audited += pending.length
    records.push(...(await Promise.all(pending)))
  }
  return records
}

async function createAccount(browser, input) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await installRecoveryCapture(context)
  const page = await context.newPage()
  const cssRequests = []
  const requestAudits = []
  const onRequest = (request) => {
    const hostname = new URL(request.url()).hostname
    if (isCssHost(hostname, input.solidHost)) {
      cssRequests.push(request.url())
    }
    requestAudits.push(captureRequestAudit(request))
  }
  page.on('request', onRequest)
  try {
    await page.goto(input.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.getByLabel('Node handle').first().waitFor({ state: 'visible', timeout: 180_000 })
    const createIdentity = page.getByText('Create a new identity', { exact: true }).first()
    if (await createIdentity.isVisible().catch(() => false)) await createIdentity.click()
    await page.getByLabel('Node handle').first().fill(input.handle)
    await page.getByLabel('Notification email').first().fill(input.email)
    await page.getByText('Create Your Node', { exact: true }).first().waitFor({
      state: 'visible',
      timeout: 120_000,
    })
    await page.getByText('Create Your Node', { exact: true }).first().click()
    await waitForAuthenticatedSurface(page, input.timeoutMs)
    await page.goto(`${input.baseUrl}/profile`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    const webId = (await page.getByLabel('Profile WebID').textContent())?.trim()
    if (!webId) throw new Error(`${input.label} did not expose an authenticated WebID.`)
    const recoveryBundle = await captureRecoveryBundle(page, input.baseUrl, input.timeoutMs)
    validateRecoveryBundle(recoveryBundle, webId)
    const recoverySecret = JSON.parse(recoveryBundle).wallet.secretKey
    page.off('request', onRequest)
    const auditedRequests = await collectRequestAudits(requestAudits)
    if (auditedRequests.some(({ auditFailed }) => auditFailed)) {
      throw new Error(`${input.label} request credential audit was incomplete.`)
    }
    if (
      auditedRequests.some(({ surfaces }) =>
        surfaces.some((surface) => surface.includes(recoverySecret))
      )
    ) {
      throw new Error(`${input.label} exposed recovery material in a network request.`)
    }
    if (cssRequests.length > 0) throw new Error(`${input.label} contacted the CSS origin directly.`)
    return { label: input.label, webId, recoveryBundle }
  } finally {
    page.off('request', onRequest)
    await context.close()
  }
}

async function verifyAccount(browser, account, baseUrl, timeoutMs) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const cssRequests = []
  const requestAudits = []
  const recoverySecret = JSON.parse(account.recoveryBundle).wallet.secretKey
  const credentialOrigins = new Set([
    new URL(baseUrl).hostname,
    'api.nodezero.social',
    'nodezero-social-staging-testnet-provisioner.azurewebsites.net',
  ])
  const onRequest = (request) => {
    const hostname = new URL(request.url()).hostname
    if (isCssHost(hostname, 'solid.nodezero.social')) cssRequests.push(hostname)
    requestAudits.push(captureRequestAudit(request))
  }
  context.on('request', onRequest)
  try {
    await importRecoveryBundle(page, baseUrl, account.recoveryBundle, timeoutMs)
    await assertEncryptedWallet(page, recoverySecret)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await waitForAuthenticatedSurface(page, timeoutMs)
    await page.goto(`${baseUrl}/profile`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.getByLabel('Profile WebID').waitFor({ state: 'visible', timeout: timeoutMs })
    const restoredWebId = (await page.getByLabel('Profile WebID').textContent())?.trim()
    if (restoredWebId !== account.webId) {
      throw new Error(`${account.label} did not restore the same authenticated identity.`)
    }
    if (cssRequests.length > 0)
      throw new Error(`${account.label} contacted the CSS origin directly.`)
    const sessionToken = validateFreshBrowserSession(await context.cookies())
    const localStorageBearer = await page.evaluate(() => localStorage.getItem('nz.session.v2'))
    if (localStorageBearer !== null) {
      throw new Error(`${account.label} persisted a forbidden browser bearer session.`)
    }
    context.off('request', onRequest)
    const auditedRequests = await collectRequestAudits(requestAudits)
    if (auditedRequests.some(({ auditFailed }) => auditFailed)) {
      throw new Error(`${account.label} request credential audit was incomplete.`)
    }
    if (
      auditedRequests.some(({ surfaces }) =>
        surfaces.some((surface) => surface.includes(recoverySecret))
      )
    ) {
      throw new Error(`${account.label} exposed recovery material in a network request.`)
    }
    if (
      auditedRequests.some(
        ({ hostname, hasAuthorization, surfaces }) =>
          !credentialOrigins.has(hostname) &&
          (hasAuthorization ||
            surfaces.some(
              (surface) =>
                surface.includes(sessionToken) || surface.includes(encodeURIComponent(sessionToken))
            ))
      )
    ) {
      throw new Error(`${account.label} sent session credentials to an external origin.`)
    }
    return createHash('sha256').update(sessionToken).digest('hex')
  } finally {
    context.off('request', onRequest)
    await context.close()
  }
}

function setEnvironmentSecret(repository, environment, name, value) {
  run('gh', githubSecretArgs(repository, environment, name), { input: value })
  log(`Stored ${name} in GitHub environment ${environment}.`)
}

function deleteEnvironmentSecret(repository, environment, name) {
  run('gh', ['secret', 'delete', name, '--repo', repository, '--env', environment])
}

async function main() {
  if (!process.argv.includes('--apply')) {
    throw new Error('Refusing to create accounts or secrets without explicit --apply.')
  }
  const baseUrl = (process.env.STAGING_BASE_URL ?? 'https://staging.nodezero.social').replace(
    /\/$/,
    ''
  )
  const repository = process.env.GITHUB_REPOSITORY ?? 'lockb0x-llc/nodezero-social'
  const environment = process.env.GITHUB_ENVIRONMENT ?? 'staging-testnet'
  const solidHost = (process.env.SOLID_HOST ?? 'solid.nodezero.social').toLowerCase()
  const timeoutMs = Number(process.env.DIRECTORY_BOOTSTRAP_TIMEOUT_MS ?? 8 * 60_000)
  assertBootstrapTarget({ baseUrl, repository, environment, solidHost })
  run('gh', ['auth', 'status', '--hostname', 'github.com'])
  const existingSecrets = new Set(
    run('gh', [
      'secret',
      'list',
      '--repo',
      repository,
      '--env',
      environment,
      '--json',
      'name',
      '--jq',
      '.[].name',
    ])
      .split(/\r?\n/)
      .filter(Boolean)
  )
  const conflictingSecrets = REQUIRED_SECRET_NAMES.filter((name) => existingSecrets.has(name))
  if (conflictingSecrets.length > 0) {
    throw new Error(
      `Refusing to overwrite existing Directory cohort secrets: ${conflictingSecrets.join(', ')}`
    )
  }

  const stamp = Date.now().toString(36)
  const accounts = [
    { label: 'A', suffix: 'a' },
    { label: 'B', suffix: 'b' },
    { label: 'control', suffix: 'c' },
  ]
  const browser = await chromium.launch({ headless: true })
  const created = []
  const verifiedSessionHashes = []
  try {
    for (const account of accounts) {
      log(`Creating isolated staging account ${account.label}.`)
      const createdAccount = await createAccount(browser, {
        ...account,
        baseUrl,
        solidHost,
        timeoutMs,
        handle: `q4${account.suffix}${stamp}${randomBytes(3).toString('hex')}`,
        email: `q4-${account.suffix}-${stamp}@qa.nodezero.social`,
      })
      log(`Account ${account.label} created; verifying its recovery path.`)
      verifiedSessionHashes.push(await verifyAccount(browser, createdAccount, baseUrl, timeoutMs))
      created.push(createdAccount)
      log(`Account ${account.label} restored successfully in a clean browser.`)
    }
    if (new Set(verifiedSessionHashes).size !== accounts.length) {
      throw new Error('Recovery verification did not mint three distinct browser sessions.')
    }
  } finally {
    await browser.close()
  }

  const cohort = deriveCohort(created.map((account) => account.webId))
  const secrets = new Map([
    ['JSS_Q_COHORT_KEY', cohort.key],
    ['JSS_Q_COHORT_HASHES', cohort.hashes.join(',')],
    ['NZ_DIRECTORY_ACCOUNT_A_RECOVERY_BUNDLE', created[0].recoveryBundle],
    ['NZ_DIRECTORY_ACCOUNT_B_RECOVERY_BUNDLE', created[1].recoveryBundle],
    ['NZ_DIRECTORY_NON_COHORT_RECOVERY_BUNDLE', created[2].recoveryBundle],
  ])
  const storedNames = []
  try {
    for (const [name, value] of secrets) {
      setEnvironmentSecret(repository, environment, name, value)
      storedNames.push(name)
    }
  } catch (error) {
    for (const name of storedNames.reverse()) {
      try {
        deleteEnvironmentSecret(repository, environment, name)
      } catch {
        console.error(`[directory-cohort-bootstrap] WARN: manual cleanup required for ${name}.`)
      }
    }
    throw error
  }
  log('PASS: three recoverable staging identities and keyed cohort secrets are provisioned.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `[directory-cohort-bootstrap] FAIL: ${error instanceof Error ? error.message : String(error)}`
    )
    process.exitCode = 1
  })
}
