import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Keypair } from '@stellar/stellar-sdk'
import { parseRecoveryBundle, sealRecoveryBundle } from './recoveryBundle.js'
import {
  assertUsablePassphrase,
  MIN_RECOVERY_PASSPHRASE_LENGTH,
} from './recoveryBundleCrypto.js'

const PROFILE = 'staging-testnet'
const NETWORK = 'Test SDF Network ; September 2015'
const PASSWORD = 'correct-horse-battery-staple'
const WEB_ID = 'https://solid.nodezero.social/alice/profile/card#me'

const keypair = Keypair.random()

async function bundle(
  overrides: Record<string, unknown> = {},
  passphrase = PASSWORD
): Promise<string> {
  const encrypted = await sealRecoveryBundle(
    { webId: WEB_ID, publicKey: keypair.publicKey(), secretKey: keypair.secret() },
    passphrase
  )
  return JSON.stringify({
    bundleVersion: 2,
    exportedAt: '2026-09-01T00:00:00.000Z',
    envProfile: PROFILE,
    stellarNetworkPassphrase: NETWORK,
    encrypted,
    ...overrides,
  })
}

void test('round-trips an encrypted bundle with the correct password', async () => {
  const parsed = await parseRecoveryBundle(await bundle(), PROFILE, NETWORK, PASSWORD)

  assert.equal(parsed.secret, keypair.secret())
  assert.equal(parsed.expectedPublicKey, keypair.publicKey())
  assert.equal(parsed.label, 'Recovered @alice')
})

void test('NC-03: the exported bundle never contains the secret in cleartext', async () => {
  const json = await bundle()

  assert.equal(json.includes(keypair.secret()), false)
  assert.equal(json.includes(WEB_ID), false)
  // Environment binding stays readable so wrong-lane bundles fail before a password prompt.
  assert.equal(json.includes(PROFILE), true)
})

void test('NC-03: a wrong password is rejected', async () => {
  await assert.rejects(
    parseRecoveryBundle(await bundle(), PROFILE, NETWORK, 'wrong-password-entirely'),
    /password is incorrect, or the bundle has been modified/i
  )
})

void test('NC-03: tampering with the ciphertext is detected', async () => {
  const parsed = JSON.parse(await bundle()) as { encrypted: { ciphertextB64: string } }
  const original = parsed.encrypted.ciphertextB64
  parsed.encrypted.ciphertextB64 = (original[0] === 'A' ? 'B' : 'A') + original.slice(1)

  await assert.rejects(
    parseRecoveryBundle(JSON.stringify(parsed), PROFILE, NETWORK, PASSWORD),
    /password is incorrect, or the bundle has been modified/i
  )
})

void test('rejects an unencrypted v1 bundle', async () => {
  const legacy = JSON.stringify({
    bundleVersion: 1,
    envProfile: PROFILE,
    stellarNetworkPassphrase: NETWORK,
    wallet: { publicKey: keypair.publicKey(), secretKey: keypair.secret() },
  })

  await assert.rejects(
    parseRecoveryBundle(legacy, PROFILE, NETWORK, PASSWORD),
    /unencrypted v1 export and is no longer accepted/i
  )
})

void test('rejects a bundle from another profile before requesting decryption', async () => {
  await assert.rejects(
    parseRecoveryBundle(
      await bundle({ envProfile: 'production-mainnet' }),
      PROFILE,
      NETWORK,
      PASSWORD
    ),
    /belongs to 'production-mainnet'/
  )
})

void test('rejects a bundle from another Stellar network', async () => {
  await assert.rejects(
    parseRecoveryBundle(
      await bundle({ stellarNetworkPassphrase: 'Public Global Stellar Network ; September 2015' }),
      PROFILE,
      NETWORK,
      PASSWORD
    ),
    /different Stellar network/
  )
})

void test('rejects a bundle whose encrypted payload is missing or malformed', async () => {
  await assert.rejects(
    parseRecoveryBundle(await bundle({ encrypted: undefined }), PROFILE, NETWORK, PASSWORD),
    /missing its encrypted payload/
  )
  await assert.rejects(
    parseRecoveryBundle(await bundle({ encrypted: { kdf: 'nope' } }), PROFILE, NETWORK, PASSWORD),
    /missing its encrypted payload/
  )
})

void test('rejects a downgraded key-derivation cost', async () => {
  const parsed = JSON.parse(await bundle()) as { encrypted: { iterations: number } }
  parsed.encrypted.iterations = 10

  await assert.rejects(
    parseRecoveryBundle(JSON.stringify(parsed), PROFILE, NETWORK, PASSWORD),
    /key-derivation cost is too low/i
  )
})

void test('rejects a passphrase shorter than the documented minimum', () => {
  assert.throws(
    () => assertUsablePassphrase('short'),
    new RegExp(`at least ${MIN_RECOVERY_PASSPHRASE_LENGTH} characters`)
  )
  assert.doesNotThrow(() => assertUsablePassphrase(PASSWORD))
})

void test('each export uses a fresh salt and IV', async () => {
  const a = JSON.parse(await bundle()) as { encrypted: { saltB64: string; ivB64: string } }
  const b = JSON.parse(await bundle()) as { encrypted: { saltB64: string; ivB64: string } }

  assert.notEqual(a.encrypted.saltB64, b.encrypted.saltB64)
  assert.notEqual(a.encrypted.ivB64, b.encrypted.ivB64)
})
