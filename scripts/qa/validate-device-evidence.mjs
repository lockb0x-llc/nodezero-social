#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

const evidencePath = process.argv[2]
if (!evidencePath) throw new Error('Usage: validate-device-evidence.mjs <evidence.json>')

const expectedSha = (process.env.NZ_DEVICE_EXPECTED_SHA ?? '').trim()
const expectedUrl = (process.env.NZ_DEVICE_EXPECTED_URL ?? 'https://staging.nodezero.social').replace(/\/$/, '')
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

const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
const failures = []

if (evidence.schemaVersion !== 1) failures.push('schemaVersion must be 1')
if (!/^[0-9a-f]{40}$/.test(expectedSha)) failures.push('NZ_DEVICE_EXPECTED_SHA must be a full commit SHA')
if (evidence.commit !== expectedSha) failures.push('evidence commit does not match the candidate SHA')
if (evidence.appUrl !== expectedUrl) failures.push('evidence appUrl does not match the canonical candidate URL')
if (evidence.envProfile !== 'staging-testnet') failures.push('evidence envProfile must be staging-testnet')
if (!Array.isArray(evidence.runs) || evidence.runs.length === 0) failures.push('evidence runs are missing')

const requiredCases = new Set([
  'canonical-onboarding',
  'retained-identity',
  'cold-relaunch',
  'offline-shell',
  'signout-signin',
  'clean-device-recovery',
  'update-relaunch',
])

for (const run of evidence.runs ?? []) {
  const prefix = `${run.platform ?? 'unknown'}/${run.mode ?? 'unknown'}`
  if (typeof run.laneId !== 'string' || !run.laneId.trim()) failures.push(`${prefix}: laneId is required`)
  if (!['ios', 'android'].includes(run.platform)) failures.push(`${prefix}: invalid platform`)
  if (!['browser-tab', 'installed-pwa'].includes(run.mode)) failures.push(`${prefix}: invalid mode`)
  if (typeof run.deviceModel !== 'string' || !run.deviceModel.trim()) failures.push(`${prefix}: deviceModel is required`)
  if (typeof run.osVersion !== 'string' || !run.osVersion.trim()) failures.push(`${prefix}: osVersion is required`)
  if (typeof run.browserVersion !== 'string' || !run.browserVersion.trim()) failures.push(`${prefix}: browserVersion is required`)
  if (!/^acct_[0-9a-f]{16}$/.test(run.accountHash ?? '')) failures.push(`${prefix}: accountHash must be sanitized`)
  if (!/^C[A-Z2-7]{55}$/.test(run.lockboxContractId ?? '')) failures.push(`${prefix}: public V3 lockb0x id is required`)
  if (!Array.isArray(run.cases)) failures.push(`${prefix}: cases are missing`)
  const caseResults = new Map((run.cases ?? []).map((item) => [item.id, item.result]))
  for (const caseId of requiredCases) {
    if (caseResults.get(caseId) !== 'pass') failures.push(`${prefix}: required case '${caseId}' did not pass`)
  }
  for (const assertion of ['sameIdentity', 'noStaleWorker', 'noPrivateCache', 'noPersistentToken']) {
    if (run.assertions?.[assertion] !== true) failures.push(`${prefix}: assertion '${assertion}' must be true`)
  }
  if (run.result !== 'pass') failures.push(`${prefix}: run result must be pass`)
  if (!Number.isFinite(Date.parse(run.startedAtUtc)) || !Number.isFinite(Date.parse(run.completedAtUtc))) {
    failures.push(`${prefix}: valid UTC timestamps are required`)
  }
}

for (const mode of requiredModes) {
  for (const laneId of requiredLaneIds[mode] ?? []) {
    if (!(evidence.runs ?? []).some((run) => run.mode === mode && run.laneId === laneId && run.result === 'pass')) {
      failures.push(`missing passing physical lane '${laneId}'`)
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[device-evidence] FAIL: ${failure}`)
  process.exit(1)
}

console.log(`[device-evidence] PASS: ${evidence.runs.length} exact-SHA physical-device lanes validated`)