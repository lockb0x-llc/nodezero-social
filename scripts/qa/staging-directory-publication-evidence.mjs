#!/usr/bin/env node

import { chromium } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import {
  DirectoryCleanupStageError,
  directoryEvidenceFailure,
  ensureDirectoryUnpublished,
} from './directory-evidence-failures.mjs'

const baseUrl = (process.env.STAGING_BASE_URL ?? 'https://staging.nodezero.social').replace(
  /\/$/,
  ''
)
const accountARecoveryPath = (process.env.DIRECTORY_ACCOUNT_A_RECOVERY_BUNDLE ?? '').trim()
const accountBRecoveryPath = (process.env.DIRECTORY_ACCOUNT_B_RECOVERY_BUNDLE ?? '').trim()
const nonCohortRecoveryPath = (process.env.DIRECTORY_NON_COHORT_RECOVERY_BUNDLE ?? '').trim()
const avatarUrl = (process.env.DIRECTORY_E2E_AVATAR_URL ?? `${baseUrl}/favicon.png`).trim()
const timeoutMs = Number(process.env.DIRECTORY_E2E_TIMEOUT_MS ?? 60_000)
const cleanupTimeoutMs = Number(process.env.DIRECTORY_E2E_CLEANUP_TIMEOUT_MS ?? timeoutMs * 3)
const requestAuditTimeoutMs = Number(process.env.DIRECTORY_REQUEST_AUDIT_TIMEOUT_MS ?? 15_000)
const cohortKey = (process.env.JSS_Q_COHORT_KEY ?? '').trim()
const configuredCohortHashes = (process.env.JSS_Q_COHORT_HASHES ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)
const evidencePath = (process.env.DIRECTORY_E2E_EVIDENCE_PATH ?? '').trim()
const startedAtUtc = new Date().toISOString()

if (
  !accountARecoveryPath ||
  !accountBRecoveryPath ||
  !nonCohortRecoveryPath ||
  !cohortKey ||
  !evidencePath
) {
  throw new Error('Three recovery bundles, cohort key, and evidence path are required.')
}
if (
  configuredCohortHashes.length !== 2 ||
  configuredCohortHashes[0] === configuredCohortHashes[1] ||
  configuredCohortHashes.some((value) => !/^[0-9a-f]{64}$/.test(value))
) {
  throw new Error('Exactly two distinct lowercase SHA-256 cohort hashes are required.')
}

function log(message) {
  console.log(`[directory-publication-evidence] ${message}`)
}

async function loadJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error(`${label} is not a readable JSON artifact.`)
  }
}

function captureRequestAudit(request) {
  let hostname = ''
  let protocol = ''
  let method = ''
  let resourceType = ''
  let baseSurfaces = []
  try {
    const url = request.url()
    const parsedUrl = new URL(url)
    hostname = parsedUrl.hostname
    protocol = parsedUrl.protocol
    const immediateHeaders =
      typeof request.headers === 'function' ? Object.values(request.headers()) : []
    baseSurfaces = [url, request.postData() ?? '', ...immediateHeaders]
    method = typeof request.method === 'function' ? request.method() : ''
    resourceType = typeof request.resourceType === 'function' ? request.resourceType() : ''
    let timeout
    const headers = Promise.resolve(request.allHeaders()).then(
      (value) => ({ available: true, value }),
      () => ({ available: false, value: null })
    )
    const deadline = new Promise((resolve) => {
      timeout = setTimeout(() => resolve({ available: false, value: null }), requestAuditTimeoutMs)
      timeout.unref?.()
    })
    return Promise.race([headers, deadline])
      .then((result) =>
        result.available
          ? {
              auditFailed: false,
              hostname,
              protocol,
              method,
              resourceType,
              hasAuthorization: Boolean(result.value.authorization),
              surfaces: [...baseSurfaces, ...Object.values(result.value)],
            }
          : {
              auditFailed: true,
              hostname,
              protocol,
              method,
              resourceType,
              hasAuthorization: false,
              surfaces: baseSurfaces,
            }
      )
      .catch(() => ({
        auditFailed: true,
        hostname,
        protocol,
        method,
        resourceType,
        hasAuthorization: false,
        surfaces: baseSurfaces,
      }))
      .finally(() => clearTimeout(timeout))
  } catch {
    return Promise.resolve({
      auditFailed: true,
      hostname,
      protocol,
      method,
      resourceType,
      hasAuthorization: false,
      surfaces: baseSurfaces,
    })
  }
}

async function waitForAuthenticatedSurface(page) {
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

async function restoreAccount(context, recoveryBundle) {
  const page = await context.newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
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
    buffer: Buffer.from(JSON.stringify(recoveryBundle)),
  })
  await page
    .getByText('Identity restored securely. Tap Sign In to continue.')
    .waitFor({ timeout: timeoutMs })
  await assertEncryptedWallet(page, recoveryBundle.wallet.secretKey)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await waitForAuthenticatedSurface(page)
  if ((await page.evaluate(() => localStorage.getItem('nz.session.v2'))) !== null) {
    throw new Error('Returning sign-in persisted a forbidden browser bearer session.')
  }
  return page
}

async function openProfile(page) {
  await page.goto(`${baseUrl}/profile`, { waitUntil: 'networkidle' })
  await page
    .getByRole('button', { name: /Publish to Directory|Unpublish from Directory/ })
    .waitFor({ timeout: timeoutMs })
}

async function loadDirectory(page) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/v1/community-directory/index') && response.status() === 200,
    { timeout: timeoutMs }
  )
  await page.goto(`${baseUrl}/directory`, { waitUntil: 'domcontentloaded' })
  await page.getByText('Community Directory', { exact: true }).waitFor({ timeout: timeoutMs })
  const response = await responsePromise
  const combined = await response.json()
  const members = [...(combined.members ?? [])]
  const loadMore = page.getByRole('button', { name: 'Load more directory entries' })
  while (await loadMore.isVisible().catch(() => false)) {
    const nextResponse = page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/v1/community-directory/index') && candidate.status() === 200,
      { timeout: timeoutMs }
    )
    await loadMore.click()
    const nextPage = await (await nextResponse).json()
    members.push(...(nextPage.members ?? []))
  }
  return { ...combined, members, nextCursor: null }
}

async function saveProfileAndWait(page) {
  const dialogPromise = page.waitForEvent('dialog', { timeout: timeoutMs })
  await page.getByRole('button', { name: 'Save profile' }).click()
  const dialog = await dialogPromise
  if (dialog.type() !== 'alert' || !dialog.message().toLowerCase().includes('profile')) {
    throw new Error(`Profile save did not confirm success: ${dialog.message()}`)
  }
}

async function drainRequestHeaderAudits() {
  let audited = 0
  while (audited < requestHeaderAudits.length) {
    const pending = requestHeaderAudits.slice(audited)
    audited += pending.length
    auditedRequests.push(...(await Promise.all(pending)))
  }
}

async function runCleanupPhase(cleanupFailures, phase, operation) {
  try {
    await operation()
  } catch (error) {
    cleanupFailures.push({
      phase: error instanceof DirectoryCleanupStageError ? `${phase}: ${error.stage}` : phase,
      error,
    })
  }
}

async function cleanupDirectoryAccount(page, directoryReader, accountWebId) {
  await openProfile(page)
  const unpublishButton = page.getByRole('button', { name: 'Unpublish from Directory' })
  const publishButton = page.getByRole('button', { name: 'Publish to Directory' })
  await ensureDirectoryUnpublished({
    isPublished: () => unpublishButton.isVisible().catch(() => false),
    unpublish: () => unpublishButton.click(),
    waitForUnpublishedIntent: () => publishButton.waitFor({ timeout: cleanupTimeoutMs }),
    retryProjection: async () => {
      const retryButton = page.getByRole('button', {
        name: 'Retry Directory synchronization',
      })
      if (await retryButton.isVisible().catch(() => false)) {
        await retryButton.click()
        await retryButton.waitFor({ state: 'hidden', timeout: cleanupTimeoutMs })
      }
    },
    readProjection: () => loadDirectory(directoryReader),
    projectionContainsAccount: (projection) =>
      projection.members?.some((record) => record.webId === accountWebId) ?? false,
  })
}

const browser = await chromium.launch({ headless: true })
const [accountARecovery, accountBRecovery, controlRecovery] = await Promise.all([
  loadJson(accountARecoveryPath, 'Account A recovery bundle'),
  loadJson(accountBRecoveryPath, 'Account B recovery bundle'),
  loadJson(nonCohortRecoveryPath, 'Control recovery bundle'),
])
const contextA = await browser.newContext()
const contextB = await browser.newContext()
const contextControl = await browser.newContext()
const contexts = [contextA, contextB, contextControl]
const recoveryBundles = [accountARecovery, accountBRecovery, controlRecovery]
const recoverySecrets = new Set(recoveryBundles.map((bundle) => bundle.wallet?.secretKey))
if (
  recoverySecrets.size !== contexts.length ||
  [...recoverySecrets].some(
    (secret) => typeof secret !== 'string' || !/^S[A-Z2-7]{55}$/.test(secret)
  )
) {
  throw new Error('Each Directory evidence account requires distinct recovery material.')
}
const credentialOrigins = new Set([
  new URL(baseUrl).hostname,
  'api.nodezero.social',
  'nodezero-social-staging-testnet-provisioner.azurewebsites.net',
])
const directCssRequests = []
const externalCredentialRequests = []
const recoveryMaterialRequests = []
const requestHeaderAudits = []
const auditedRequests = []
const requestListeners = new Map()
for (const context of contexts) {
  const onRequest = (request) => {
    const hostname = new URL(request.url()).hostname
    if (hostname === 'solid.nodezero.social' || hostname.endsWith('.solid.nodezero.social')) {
      directCssRequests.push(request.url())
    }
    requestHeaderAudits.push(captureRequestAudit(request))
  }
  requestListeners.set(context, onRequest)
  context.on('request', onRequest)
}
const pageA = await restoreAccount(contextA, accountARecovery)
const pageB = await restoreAccount(contextB, accountBRecovery)
const pageControl = await restoreAccount(contextControl, controlRecovery)
const sessionTokens = await Promise.all(
  contexts.map(async (context) => {
    const sessions = (await context.cookies()).filter(
      (cookie) => cookie.name === '__Host-nz_browser_session'
    )
    if (
      sessions.length !== 1 ||
      !sessions[0]?.value ||
      sessions[0].httpOnly !== true ||
      sessions[0].secure !== true
    ) {
      throw new Error('Recovery sign-in did not mint one secure opaque browser session.')
    }
    return sessions[0].value
  })
)
const browserSessionTokens = new Set(sessionTokens)
if (browserSessionTokens.size !== contexts.length) {
  throw new Error('Each Directory evidence account requires a distinct fresh browser session.')
}
pageA.on('dialog', (dialog) => void dialog.accept())
pageB.on('dialog', (dialog) => void dialog.accept())
pageControl.on('dialog', (dialog) => void dialog.accept())

const token = Date.now().toString(36)
const initialName = `Directory A ${token}`
const updatedName = `${initialName} Updated`
const privateBio = `private-${token}`
let originalProfile = null
let primaryError = null
const cleanupFailures = []
let accountAWebId = ''
let accountBWebId = ''
let accountAHash = ''
let accountBHash = ''

try {
  await openProfile(pageA)
  await openProfile(pageB)
  await pageControl.goto(`${baseUrl}/profile`, { waitUntil: 'networkidle' })
  await pageControl.getByLabel('Profile WebID').waitFor({ timeout: timeoutMs })
  accountAWebId = (await pageA.getByLabel('Profile WebID').textContent())?.trim() ?? ''
  accountBWebId = (await pageB.getByLabel('Profile WebID').textContent())?.trim() ?? ''
  const controlWebId = (await pageControl.getByLabel('Profile WebID').textContent())?.trim()
  if (
    !accountAWebId ||
    !accountBWebId ||
    !controlWebId ||
    new Set([accountAWebId, accountBWebId, controlWebId]).size !== 3
  ) {
    throw new Error('Directory E2E requires three distinct authenticated accounts.')
  }
  accountAHash = createHmac('sha256', cohortKey).update(accountAWebId).digest('hex')
  accountBHash = createHmac('sha256', cohortKey).update(accountBWebId).digest('hex')
  const controlHash = createHmac('sha256', cohortKey).update(controlWebId).digest('hex')
  if (
    [accountAHash, accountBHash].sort().join(',') !== [...configuredCohortHashes].sort().join(',')
  ) {
    throw new Error('Directory cohort hashes do not match the two cohort browser accounts.')
  }
  if (configuredCohortHashes.includes(controlHash)) {
    throw new Error('The Directory control browser account is included in the cohort.')
  }
  await pageControl.goto(`${baseUrl}/directory`, { waitUntil: 'networkidle' })
  await pageControl
    .getByText('Community Directory is not available for this account.')
    .waitFor({ timeout: timeoutMs })
  log('PASS browser identities match the configured cohort')
  for (const page of [pageA, pageB]) {
    if (
      await page
        .getByRole('button', { name: 'Unpublish from Directory' })
        .isVisible()
        .catch(() => false)
    ) {
      throw new Error('Directory cohort accounts must begin with publication off.')
    }
  }
  const initialDirectory = await loadDirectory(pageB)
  if (
    initialDirectory.members?.some(
      (record) => record.webId === accountAWebId || record.webId === accountBWebId
    )
  ) {
    throw new Error('Directory cohort accounts must be absent from the derived index initially.')
  }

  originalProfile = {
    displayName: await pageA.getByPlaceholder('Your name').inputValue(),
    bio: await pageA.getByPlaceholder('Tell the world about yourself').inputValue(),
    avatarUrl: await pageA.getByPlaceholder('https://…').first().inputValue(),
  }

  await pageA.getByPlaceholder('Your name').fill(initialName)
  await pageA.getByPlaceholder('Tell the world about yourself').fill(privateBio)
  const initialAvatarUrl = `${avatarUrl}?directory=${token}`
  const updatedAvatarUrl = `${avatarUrl}?directory=${token}-updated`
  await pageA.getByPlaceholder('https://…').first().fill(initialAvatarUrl)
  await pageA.getByRole('button', { name: 'Publish to Directory' }).click()
  await pageA
    .getByText('Your basic profile is published to the Directory.')
    .waitFor({ timeout: timeoutMs })
  log('PASS publish basic profile')

  const initialPage = await loadDirectory(pageB)
  await pageB.getByText(initialName, { exact: true }).waitFor({ timeout: timeoutMs })
  const initialRecord = initialPage.members?.find((record) => record.displayName === initialName)
  if (
    !initialRecord ||
    initialRecord.webId !== accountAWebId ||
    initialRecord.avatarUrl !== initialAvatarUrl
  ) {
    throw new Error('Directory projection did not contain the published avatar URL.')
  }
  const allowedRecordKeys = new Set([
    'webId',
    'podUrl',
    'issuer',
    'listed',
    'listedAt',
    'updatedAt',
    'displayName',
    'avatarUrl',
    'manifestUrl',
    'manifestPublishedAt',
    'manifestExpiresAt',
    'consentUpdatedAt',
    'consentRevision',
    'sourceRevision',
  ])
  const unexpectedRecordKeys = Object.keys(initialRecord).filter(
    (key) => !allowedRecordKeys.has(key)
  )
  if (unexpectedRecordKeys.length > 0) {
    throw new Error(`Directory record exposed unexpected fields: ${unexpectedRecordKeys.join(',')}`)
  }
  if (initialRecord.publicInterests || initialRecord.capabilities || initialRecord.inboxUrl) {
    throw new Error('Listing-only projection exposed indexed metadata.')
  }
  if (await pageB.getByText(privateBio, { exact: true }).count()) {
    throw new Error('Private bio appeared in the Directory.')
  }
  if (await pageB.getByRole('button', { name: `Open profile for ${initialName}` }).count()) {
    throw new Error('Peer Profile action appeared while peer-profile is disabled.')
  }
  if (await pageB.getByRole('button', { name: new RegExp(`Connect.*${initialName}`) }).count()) {
    throw new Error('Connect action appeared while relationship is disabled.')
  }
  if (await pageB.getByRole('button', { name: new RegExp(`Message.*${initialName}`) }).count()) {
    throw new Error('Message action appeared while transport is disabled.')
  }
  const avatar = pageB.getByLabel(`${initialName} avatar`, { exact: true })
  await avatar.waitFor({ timeout: timeoutMs })
  await avatar.evaluate(
    (element) =>
      new Promise((resolve, reject) => {
        const image = element
        if (image.complete) {
          image.naturalWidth > 0 ? resolve(true) : reject(new Error('Avatar decode failed.'))
          return
        }
        image.addEventListener('load', () => resolve(true), { once: true })
        image.addEventListener('error', () => reject(new Error('Avatar decode failed.')), {
          once: true,
        })
      })
  )
  const avatarElement = await avatar.evaluate((element) => ({
    tagName: element.tagName,
    source: element.getAttribute('src'),
    complete: element.complete,
    naturalWidth: element.naturalWidth,
  }))
  if (
    avatarElement.tagName !== 'IMG' ||
    !avatarElement.source?.startsWith('data:image/png;base64,') ||
    !avatarElement.complete ||
    avatarElement.naturalWidth <= 0
  ) {
    throw new Error('Directory avatar did not render proxied image bytes.')
  }
  log('PASS second account sees basic fields only')

  await openProfile(pageA)
  await pageA.getByPlaceholder('Your name').fill(updatedName)
  await pageA.getByPlaceholder('https://…').first().fill(updatedAvatarUrl)
  await saveProfileAndWait(pageA)
  const updatedPage = await loadDirectory(pageB)
  await pageB.getByText(updatedName, { exact: true }).waitFor({ timeout: timeoutMs })
  const updatedRecord = updatedPage.members?.find((record) => record.displayName === updatedName)
  if (!updatedRecord || updatedRecord.avatarUrl !== updatedAvatarUrl) {
    throw new Error('Directory projection did not update the published avatar URL.')
  }
  log('PASS listed profile update propagated')

  await openProfile(pageA)
  await pageA.getByRole('button', { name: 'Unpublish from Directory' }).click()
  await pageA
    .getByText('Your profile is no longer listed in the Directory.')
    .waitFor({ timeout: timeoutMs })
  const unlistedPage = await loadDirectory(pageB)
  if (unlistedPage.members?.some((record) => record.webId === accountAWebId)) {
    throw new Error('Unpublished account remained in the Directory response.')
  }
  await pageB
    .getByText(updatedName, { exact: true })
    .waitFor({ state: 'detached', timeout: timeoutMs })
  log('PASS unpublish removed projection')
} catch (error) {
  primaryError = error
} finally {
  await Promise.all([
    runCleanupPhase(cleanupFailures, 'account A unpublish verification', async () => {
      if (!accountAWebId) return
      const directoryReader = await contextA.newPage()
      await cleanupDirectoryAccount(pageA, directoryReader, accountAWebId)
    }),
    runCleanupPhase(cleanupFailures, 'account B unpublish verification', async () => {
      if (!accountBWebId) return
      const directoryReader = await contextB.newPage()
      await cleanupDirectoryAccount(pageB, directoryReader, accountBWebId)
    }),
  ])
  await runCleanupPhase(cleanupFailures, 'profile restoration', async () => {
    if (originalProfile) {
      await openProfile(pageA)
      await pageA.getByPlaceholder('Your name').fill(originalProfile.displayName)
      await pageA.getByPlaceholder('Tell the world about yourself').fill(originalProfile.bio)
      await pageA.getByPlaceholder('https://…').first().fill(originalProfile.avatarUrl)
      await saveProfileAndWait(pageA)
      await openProfile(pageA)
      if (
        (await pageA.getByPlaceholder('Your name').inputValue()) !== originalProfile.displayName ||
        (await pageA.getByPlaceholder('Tell the world about yourself').inputValue()) !==
          originalProfile.bio ||
        (await pageA.getByPlaceholder('https://…').first().inputValue()) !==
          originalProfile.avatarUrl
      ) {
        throw new Error('Original profile values were not restored.')
      }
    }
  })
  await runCleanupPhase(cleanupFailures, 'request audit', async () => {
    if (directCssRequests.length > 0) throw new Error('Browser contacted the CSS origin directly.')
    for (const [context, onRequest] of requestListeners) {
      context.off('request', onRequest)
    }
    await drainRequestHeaderAudits()
    if (
      auditedRequests.some(
        ({ auditFailed, hostname }) => auditFailed && !credentialOrigins.has(hostname)
      )
    ) {
      throw new Error('Browser external request credential audit was incomplete.')
    }
    for (const { hostname, hasAuthorization, surfaces } of auditedRequests) {
      const containsSessionToken = [...browserSessionTokens].some((token) =>
        surfaces.some(
          (surface) => surface.includes(token) || surface.includes(encodeURIComponent(token))
        )
      )
      if (!credentialOrigins.has(hostname) && (hasAuthorization || containsSessionToken)) {
        externalCredentialRequests.push(hostname)
      }
      if (
        [...recoverySecrets].some((secret) => surfaces.some((surface) => surface.includes(secret)))
      ) {
        recoveryMaterialRequests.push(hostname)
      }
    }
    if (externalCredentialRequests.length > 0) {
      throw new Error('Browser sent session credentials to an external origin.')
    }
    if (recoveryMaterialRequests.length > 0) {
      throw new Error('Browser exposed recovery material in a network request.')
    }
    log('PASS zero direct CSS, external credential, and recovery-material requests')
  })
  await runCleanupPhase(cleanupFailures, 'account A browser close', () => contextA.close())
  await runCleanupPhase(cleanupFailures, 'account B browser close', () => contextB.close())
  await runCleanupPhase(cleanupFailures, 'control browser close', () => contextControl.close())
  await runCleanupPhase(cleanupFailures, 'browser close', () => browser.close())
}

const terminalError = directoryEvidenceFailure(primaryError, cleanupFailures)
if (terminalError) throw terminalError

await writeFile(
  evidencePath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      commit: process.env.GITHUB_SHA ?? '',
      runId: process.env.GITHUB_RUN_ID ?? '',
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? '',
      appUrl: baseUrl,
      startedAtUtc,
      completedAtUtc: new Date().toISOString(),
      accounts: [
        { label: 'A', identityHash: accountAHash },
        { label: 'B', identityHash: accountBHash },
      ],
      cases: [
        'distinct-accounts',
        'initial-derived-index-clean',
        'publish-basic-profile',
        'basic-field-allowlist',
        'proxied-avatar',
        'later-actions-disabled',
        'profile-update',
        'unpublish',
        'css-embargo',
        'external-credential-embargo',
      ],
      result: 'pass',
    },
    null,
    2
  )}\n`,
  'utf8'
)
