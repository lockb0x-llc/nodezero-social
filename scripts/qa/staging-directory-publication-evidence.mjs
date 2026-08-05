#!/usr/bin/env node

import { chromium } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const baseUrl = (process.env.STAGING_BASE_URL ?? 'https://staging.nodezero.social').replace(
  /\/$/,
  ''
)
const accountAState = (process.env.DIRECTORY_ACCOUNT_A_STORAGE_STATE ?? '').trim()
const accountBState = (process.env.DIRECTORY_ACCOUNT_B_STORAGE_STATE ?? '').trim()
const nonCohortState = (process.env.DIRECTORY_NON_COHORT_STORAGE_STATE ?? '').trim()
const avatarUrl = (process.env.DIRECTORY_E2E_AVATAR_URL ?? `${baseUrl}/favicon.png`).trim()
const timeoutMs = Number(process.env.DIRECTORY_E2E_TIMEOUT_MS ?? 60_000)
const cohortKey = (process.env.JSS_Q_COHORT_KEY ?? '').trim()
const configuredCohortHashes = (process.env.JSS_Q_COHORT_HASHES ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)
const evidencePath = (process.env.DIRECTORY_E2E_EVIDENCE_PATH ?? '').trim()
const startedAtUtc = new Date().toISOString()

if (!accountAState || !accountBState || !nonCohortState || !cohortKey || !evidencePath) {
  throw new Error(
    'Two cohort states, one control state, cohort key, and evidence path are required.'
  )
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
    await Promise.all(pending)
  }
}

const browser = await chromium.launch({ headless: true })
const contextA = await browser.newContext({ storageState: accountAState })
const contextB = await browser.newContext({ storageState: accountBState })
const contextControl = await browser.newContext({ storageState: nonCohortState })
const contexts = [contextA, contextB, contextControl]
const browserSessionTokens = new Set(
  (await Promise.all(contexts.map((context) => context.cookies(baseUrl))))
    .flat()
    .filter((cookie) => cookie.name === '__Host-nz_browser_session')
    .map((cookie) => cookie.value)
)
if (browserSessionTokens.size !== contexts.length) {
  throw new Error('Each Directory evidence account requires a distinct browser session.')
}
const credentialOrigins = new Set([
  new URL(baseUrl).hostname,
  'api.nodezero.social',
  'nodezero-social-staging-testnet-provisioner.azurewebsites.net',
])
const directCssRequests = []
const externalCredentialRequests = []
const requestHeaderAudits = []
for (const context of contexts) {
  context.on('request', (request) => {
    const hostname = new URL(request.url()).hostname
    if (hostname === 'solid.nodezero.social') {
      directCssRequests.push(request.url())
    }
    requestHeaderAudits.push(
      request.allHeaders().then((headers) => {
        const requestSurfaces = [request.url(), request.postData() ?? '', ...Object.values(headers)]
        const containsSessionToken = [...browserSessionTokens].some((token) =>
          requestSurfaces.some(
            (surface) => surface.includes(token) || surface.includes(encodeURIComponent(token))
          )
        )
        if (!credentialOrigins.has(hostname) && (headers.authorization || containsSessionToken)) {
          externalCredentialRequests.push(hostname)
        }
      })
    )
  })
}
const pageA = await contextA.newPage()
const pageB = await contextB.newPage()
const pageControl = await contextControl.newPage()
pageA.on('dialog', (dialog) => void dialog.accept())
pageB.on('dialog', (dialog) => void dialog.accept())
pageControl.on('dialog', (dialog) => void dialog.accept())

const token = Date.now().toString(36)
const initialName = `Directory A ${token}`
const updatedName = `${initialName} Updated`
const privateBio = `private-${token}`
let originalProfile = null
let cleanupError = null
let accountAHash = ''
let accountBHash = ''

try {
  await openProfile(pageA)
  await openProfile(pageB)
  await pageControl.goto(`${baseUrl}/profile`, { waitUntil: 'networkidle' })
  await pageControl.getByLabel('Profile WebID').waitFor({ timeout: timeoutMs })
  const accountAWebId = (await pageA.getByLabel('Profile WebID').textContent())?.trim()
  const accountBWebId = (await pageB.getByLabel('Profile WebID').textContent())?.trim()
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
} finally {
  try {
    await openProfile(pageA)
    const cleanupUnpublish = pageA.getByRole('button', { name: 'Unpublish from Directory' })
    if (await cleanupUnpublish.isVisible().catch(() => false)) {
      await cleanupUnpublish.click()
      await pageA
        .getByText('Your profile is no longer listed in the Directory.')
        .waitFor({ timeout: timeoutMs })
    }
    if (originalProfile) {
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
    if (directCssRequests.length > 0) throw new Error('Browser contacted the CSS origin directly.')
    await drainRequestHeaderAudits()
    if (externalCredentialRequests.length > 0) {
      throw new Error('Browser sent session credentials to an external origin.')
    }
    log('PASS zero direct CSS and external credential requests')
  } catch (error) {
    cleanupError = error
  }
  await contextA.close()
  await contextB.close()
  await contextControl.close()
  await browser.close()
  if (cleanupError) {
    throw new Error(
      `Directory E2E cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
    )
  }
}

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
