import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { Keypair, Networks } from '@stellar/stellar-sdk'

const script = resolve('scripts/qa/validate-directory-cohort-states.mjs')
const cohortKey = 'fixed-test-key-that-is-at-least-thirty-two-characters'

function recoveryBundle(keypair, slug) {
  return JSON.stringify({
    bundleVersion: 1,
    envProfile: 'staging-testnet',
    stellarNetworkPassphrase: Networks.TESTNET,
    webId: `https://solid.nodezero.social/${slug}/profile/card#me`,
    wallet: { publicKey: keypair.publicKey(), secretKey: keypair.secret() },
  })
}

function fixture(overrides = {}) {
  const keypairs = [Keypair.random(), Keypair.random(), Keypair.random()]
  const bundles = keypairs.map((keypair, index) => recoveryBundle(keypair, `qa-${index}`))
  const webIds = bundles.map((bundle) => JSON.parse(bundle).webId)
  return {
    bundles,
    hashes: webIds
      .slice(0, 2)
      .map((webId) => createHmac('sha256', cohortKey).update(webId).digest('hex')),
    ...overrides,
  }
}

function runValidator(input = fixture()) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      JSS_Q_COHORT_KEY: cohortKey,
      JSS_Q_COHORT_HASHES: input.hashes.join(','),
      DIRECTORY_ACCOUNT_A_RECOVERY_BUNDLE: input.bundles[0],
      DIRECTORY_ACCOUNT_B_RECOVERY_BUNDLE: input.bundles[1],
      DIRECTORY_NON_COHORT_RECOVERY_BUNDLE: input.bundles[2],
    },
  })
}

void test('accepts three bound recovery artifacts', () => {
  const result = runValidator()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /recovery artifacts validated/)
})

void test('rejects duplicate recovery identities', () => {
  const input = fixture()
  input.bundles[1] = input.bundles[0]
  const result = runValidator(input)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /three distinct WebIDs/)
})

void test('rejects cohort hashes that do not match the recovery WebIDs', () => {
  const input = fixture({ hashes: ['a'.repeat(64), 'b'.repeat(64)] })
  const result = runValidator(input)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /do not match the two cohort recovery accounts/)
})
