import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Keypair } from '@stellar/stellar-sdk'

import { parseRecoveryBundle } from './recoveryBundle.js'

const PROFILE = 'staging-testnet'
const PASSPHRASE = 'Test SDF Network ; September 2015'

function bundle(overrides: Record<string, unknown> = {}): string {
  const keypair = Keypair.random()
  return JSON.stringify({
    bundleVersion: 1,
    envProfile: PROFILE,
    stellarNetworkPassphrase: PASSPHRASE,
    webId: 'https://solid.nodezero.social/alice/profile/card#me',
    wallet: { publicKey: keypair.publicKey(), secretKey: keypair.secret() },
    ...overrides,
  })
}

void test('parses a profile-bound recovery identity', () => {
  const parsed = parseRecoveryBundle(bundle(), PROFILE, PASSPHRASE)
  assert.match(parsed.expectedPublicKey, /^G/)
  assert.match(parsed.secret, /^S/)
  assert.equal(parsed.label, 'Recovered @alice')
})

void test('rejects a recovery bundle from another profile', () => {
  assert.throws(
    () => parseRecoveryBundle(bundle({ envProfile: 'production-mainnet' }), PROFILE, PASSPHRASE),
    /production-mainnet.*staging-testnet/i,
  )
})

void test('rejects a recovery bundle from another network', () => {
  assert.throws(
    () => parseRecoveryBundle(bundle({ stellarNetworkPassphrase: 'Public Global Stellar Network ; September 2015' }), PROFILE, PASSPHRASE),
    /different Stellar network/i,
  )
})

void test('rejects malformed key material', () => {
  assert.throws(
    () => parseRecoveryBundle(bundle({ wallet: { publicKey: 'invalid', secretKey: 'invalid' } }), PROFILE, PASSPHRASE),
    /invalid Stellar public key/i,
  )
})