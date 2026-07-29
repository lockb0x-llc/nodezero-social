import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const SHA = 'a'.repeat(40)
const URL = 'https://staging.nodezero.social'
const cases = [
  'canonical-onboarding',
  'retained-identity',
  'cold-relaunch',
  'offline-shell',
  'signout-signin',
  'clean-device-recovery',
  'update-relaunch',
].map((id) => ({ id, result: 'pass' }))

function run(platform, mode, laneId) {
  return {
    laneId,
    platform,
    mode,
    deviceModel: platform === 'ios' ? 'iPhone 15' : 'Pixel 8',
    osVersion: 'current',
    browserVersion: 'current',
    accountHash: 'acct_0123456789abcdef',
    lockboxContractId: `C${'A'.repeat(55)}`,
    startedAtUtc: '2026-07-29T00:00:00Z',
    completedAtUtc: '2026-07-29T00:10:00Z',
    cases,
    assertions: {
      sameIdentity: true,
      noStaleWorker: true,
      noPrivateCache: true,
      noPersistentToken: true,
    },
    result: 'pass',
  }
}

async function withEvidence(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'nodezero-device-evidence-'))
  try {
    const file = join(directory, 'evidence.json')
    await callback(file)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

void test('accepts complete exact-SHA physical-device evidence', async () => {
  await withEvidence(async (file) => {
    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      commit: SHA,
      appUrl: URL,
      envProfile: 'staging-testnet',
      runs: [
        run('ios', 'browser-tab', 'ios-safari-current'),
        run('ios', 'browser-tab', 'ios-safari-previous'),
        run('android', 'browser-tab', 'android-chrome-pixel'),
        run('android', 'browser-tab', 'android-chrome-samsung'),
        run('ios', 'installed-pwa', 'ios-installed-pwa'),
        run('android', 'installed-pwa', 'android-installed-pwa'),
      ],
    }))
    const output = execFileSync(process.execPath, ['scripts/qa/validate-device-evidence.mjs', file], {
      cwd: process.cwd(),
      env: { ...process.env, NZ_DEVICE_EXPECTED_SHA: SHA, NZ_DEVICE_EXPECTED_URL: URL },
      encoding: 'utf8',
    })
    assert.match(output, /PASS/)
  })
})

void test('rejects evidence for another commit', async () => {
  await withEvidence(async (file) => {
    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      commit: 'b'.repeat(40),
      appUrl: URL,
      envProfile: 'staging-testnet',
      runs: [
        run('ios', 'browser-tab', 'ios-safari-current'),
        run('ios', 'browser-tab', 'ios-safari-previous'),
        run('android', 'browser-tab', 'android-chrome-pixel'),
        run('android', 'browser-tab', 'android-chrome-samsung'),
        run('ios', 'installed-pwa', 'ios-installed-pwa'),
        run('android', 'installed-pwa', 'android-installed-pwa'),
      ],
    }))
    assert.throws(() => execFileSync(process.execPath, ['scripts/qa/validate-device-evidence.mjs', file], {
      cwd: process.cwd(),
      env: { ...process.env, NZ_DEVICE_EXPECTED_SHA: SHA, NZ_DEVICE_EXPECTED_URL: URL },
      stdio: 'pipe',
    }))
  })
})

void test('rejects evidence missing a required physical lane', async () => {
  await withEvidence(async (file) => {
    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      commit: SHA,
      appUrl: URL,
      envProfile: 'staging-testnet',
      runs: [
        run('ios', 'browser-tab', 'ios-safari-current'),
        run('ios', 'browser-tab', 'ios-safari-previous'),
        run('android', 'browser-tab', 'android-chrome-pixel'),
        run('ios', 'installed-pwa', 'ios-installed-pwa'),
        run('android', 'installed-pwa', 'android-installed-pwa'),
      ],
    }))
    assert.throws(() => execFileSync(process.execPath, ['scripts/qa/validate-device-evidence.mjs', file], {
      cwd: process.cwd(),
      env: { ...process.env, NZ_DEVICE_EXPECTED_SHA: SHA, NZ_DEVICE_EXPECTED_URL: URL },
      stdio: 'pipe',
    }))
  })
})