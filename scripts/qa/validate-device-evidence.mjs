#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

const evidencePath = process.argv[2]
if (!evidencePath) throw new Error('Usage: validate-device-evidence.mjs <evidence.json>')

const expectedSha = (process.env.NZ_DEVICE_EXPECTED_SHA ?? '').trim()
const expectedUrl = (
  process.env.NZ_DEVICE_EXPECTED_URL ?? 'https://staging.nodezero.social'
).replace(/\/$/, '')
const requiredModes = (process.env.NZ_DEVICE_REQUIRED_MODES ?? 'browser-tab,installed-pwa')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const requiredLaneIds = {
  'browser-tab': [
    'ios-safari-current',
    'ios-safari-previous',
    'android-chrome-pixel',
    'android-chrome-samsung',
  ],
  'installed-pwa': ['ios-installed-pwa', 'android-installed-pwa'],
}
const laneContracts = {
  'ios-safari-current': { platform: 'ios', mode: 'browser-tab', browser: /^\d+(?:\.\d+){0,3}$/ },
  'ios-safari-previous': { platform: 'ios', mode: 'browser-tab', browser: /^\d+(?:\.\d+){0,3}$/ },
  'android-chrome-pixel': {
    platform: 'android',
    mode: 'browser-tab',
    browser: /^\d+(?:\.\d+){0,3}$/,
  },
  'android-chrome-samsung': {
    platform: 'android',
    mode: 'browser-tab',
    browser: /^\d+(?:\.\d+){0,3}$/,
  },
  'ios-installed-pwa': { platform: 'ios', mode: 'installed-pwa', browser: /^\d+(?:\.\d+){0,3}$/ },
  'android-installed-pwa': {
    platform: 'android',
    mode: 'installed-pwa',
    browser: /^\d+(?:\.\d+){0,3}$/,
  },
}
const safeDeviceModels = new Set([
  'iPhone 15',
  'iPhone 15 Pro',
  'iPhone 16',
  'iPhone 16 Pro',
  'Pixel 8',
  'Pixel 9',
  'Samsung Galaxy S24',
  'Samsung Galaxy S25',
])
const versionPattern = /^\d+(?:\.\d+){0,3}$/

const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
const failures = []
const allowedTopLevelKeys = new Set(['schemaVersion', 'commit', 'appUrl', 'envProfile', 'runs'])
const allowedRunKeys = new Set([
  'laneId',
  'platform',
  'mode',
  'deviceModel',
  'osVersion',
  'browserVersion',
  'accountHash',
  'lockboxContractId',
  'startedAtUtc',
  'completedAtUtc',
  'cases',
  'assertions',
  'result',
])
const allowedCaseKeys = new Set(['id', 'result'])
const allowedAssertionKeys = new Set([
  'sameIdentity',
  'noStaleWorker',
  'noPrivateCache',
  'noPersistentToken',
])

function rejectUnknownKeys(value, allowed, prefix) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failures.push(`${prefix}: expected an object`)
    return
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) failures.push(`${prefix}: unknown field '${key}' is forbidden`)
  }
}

rejectUnknownKeys(evidence, allowedTopLevelKeys, 'evidence')

if (evidence.schemaVersion !== 1) failures.push('schemaVersion must be 1')
if (!/^[0-9a-f]{40}$/.test(expectedSha))
  failures.push('NZ_DEVICE_EXPECTED_SHA must be a full commit SHA')
if (evidence.commit !== expectedSha)
  failures.push('evidence commit does not match the candidate SHA')
if (evidence.appUrl !== expectedUrl)
  failures.push('evidence appUrl does not match the canonical candidate URL')
if (evidence.envProfile !== 'staging-testnet')
  failures.push('evidence envProfile must be staging-testnet')
if (!Array.isArray(evidence.runs) || evidence.runs.length === 0)
  failures.push('evidence runs are missing')

const requiredCases = new Set([
  'canonical-onboarding',
  'retained-identity',
  'cold-relaunch',
  'offline-shell',
  'signout-signin',
  'clean-device-recovery',
  'update-relaunch',
])
const expectedLaneIds = requiredModes.flatMap((mode) => requiredLaneIds[mode] ?? [])
const expectedLaneCount = expectedLaneIds.length
if ((evidence.runs ?? []).length !== expectedLaneCount) {
  failures.push(`evidence must contain exactly ${expectedLaneCount} physical lanes`)
}

for (const run of evidence.runs ?? []) {
  const prefix = `${run.platform ?? 'unknown'}/${run.mode ?? 'unknown'}`
  rejectUnknownKeys(run, allowedRunKeys, prefix)
  const laneContract = laneContracts[run.laneId]
  if (typeof run.laneId !== 'string' || !run.laneId.trim())
    failures.push(`${prefix}: laneId is required`)
  if (!laneContract) failures.push(`${prefix}: laneId is not approved`)
  if (!['ios', 'android'].includes(run.platform)) failures.push(`${prefix}: invalid platform`)
  if (!['browser-tab', 'installed-pwa'].includes(run.mode)) failures.push(`${prefix}: invalid mode`)
  if (laneContract && (run.platform !== laneContract.platform || run.mode !== laneContract.mode)) {
    failures.push(`${prefix}: lane platform/mode contract mismatch`)
  }
  if (!safeDeviceModels.has(run.deviceModel))
    failures.push(`${prefix}: deviceModel is not approved`)
  if (!versionPattern.test(run.osVersion ?? ''))
    failures.push(`${prefix}: osVersion must be numeric`)
  if (!laneContract?.browser.test(run.browserVersion ?? '')) {
    failures.push(`${prefix}: browserVersion must be numeric`)
  }
  if (!/^acct_[0-9a-f]{16}$/.test(run.accountHash ?? ''))
    failures.push(`${prefix}: accountHash must be sanitized`)
  if (!/^C[A-Z2-7]{55}$/.test(run.lockboxContractId ?? ''))
    failures.push(`${prefix}: public V3 lockb0x id is required`)
  if (!Array.isArray(run.cases)) failures.push(`${prefix}: cases are missing`)
  for (const item of run.cases ?? []) rejectUnknownKeys(item, allowedCaseKeys, `${prefix}/case`)
  rejectUnknownKeys(run.assertions, allowedAssertionKeys, `${prefix}/assertions`)
  const caseResults = new Map((run.cases ?? []).map((item) => [item.id, item.result]))
  if (caseResults.size !== requiredCases.size || (run.cases ?? []).length !== requiredCases.size) {
    failures.push(`${prefix}: cases must contain exactly the approved case set`)
  }
  for (const item of run.cases ?? []) {
    if (!requiredCases.has(item.id))
      failures.push(`${prefix}: unapproved case '${String(item.id)}'`)
    if (item.result !== 'pass') failures.push(`${prefix}: case '${String(item.id)}' must pass`)
  }
  for (const caseId of requiredCases) {
    if (caseResults.get(caseId) !== 'pass')
      failures.push(`${prefix}: required case '${caseId}' did not pass`)
  }
  for (const assertion of [
    'sameIdentity',
    'noStaleWorker',
    'noPrivateCache',
    'noPersistentToken',
  ]) {
    if (run.assertions?.[assertion] !== true)
      failures.push(`${prefix}: assertion '${assertion}' must be true`)
  }
  if (run.result !== 'pass') failures.push(`${prefix}: run result must be pass`)
  if (
    !Number.isFinite(Date.parse(run.startedAtUtc)) ||
    !Number.isFinite(Date.parse(run.completedAtUtc))
  ) {
    failures.push(`${prefix}: valid UTC timestamps are required`)
  }
}

for (const mode of requiredModes) {
  for (const laneId of requiredLaneIds[mode] ?? []) {
    if (
      !(evidence.runs ?? []).some(
        (run) => run.mode === mode && run.laneId === laneId && run.result === 'pass'
      )
    ) {
      failures.push(`missing passing physical lane '${laneId}'`)
    }
  }
}

for (const run of evidence.runs ?? []) {
  if (!expectedLaneIds.includes(run.laneId)) {
    failures.push(`lane '${String(run.laneId)}' is not allowed for required modes`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[device-evidence] FAIL: ${failure}`)
  process.exit(1)
}

console.log(
  `[device-evidence] PASS: ${evidence.runs.length} exact-SHA physical-device lanes validated`
)
