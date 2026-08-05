import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve('scripts/qa/validate-directory-cohort-states.mjs')
const cohortHashes = `${'a'.repeat(64)},${'b'.repeat(64)}`

function storageState(token) {
  return JSON.stringify({
    cookies: [
      {
        name: '__Host-nz_browser_session',
        value: token,
        domain: 'staging.nodezero.social',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  })
}

function runValidator(tokens) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      JSS_Q_COHORT_HASHES: cohortHashes,
      DIRECTORY_ACCOUNT_A_STORAGE_STATE: storageState(tokens[0]),
      DIRECTORY_ACCOUNT_B_STORAGE_STATE: storageState(tokens[1]),
      DIRECTORY_NON_COHORT_STORAGE_STATE: storageState(tokens[2]),
    },
  })
}

void test('accepts three distinct opaque browser sessions', () => {
  const result = runValidator(['opaque-session-a', 'opaque-session-b', 'opaque-session-control'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /storage states validated/)
})

void test('rejects duplicate browser sessions', () => {
  const result = runValidator(['opaque-session-a', 'opaque-session-a', 'opaque-session-control'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /three distinct browser sessions/)
})
