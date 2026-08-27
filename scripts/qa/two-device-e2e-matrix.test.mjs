import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  createTestAccount,
  runTwoDeviceMatrixVerification,
} from './two-device-e2e-matrix.mjs'

void test('two-device matrix verification executes 5 verification steps cleanly', async () => {
  const result = await runTwoDeviceMatrixVerification()
  assert.equal(result.success, true)
  assert.equal(result.steps, 5)
  assert.ok(result.aliceWebId.includes('alice'))
  assert.ok(result.bobWebId.includes('bob'))
})

void test('createTestAccount produces unique Stellar keypairs and WebIDs', () => {
  const alice = createTestAccount('alice')
  const bob = createTestAccount('bob')

  assert.notEqual(alice.publicKey, bob.publicKey)
  assert.notEqual(alice.secretKey, bob.secretKey)
  assert.notEqual(alice.webId, bob.webId)
  assert.match(alice.publicKey, /^G[A-Z2-7]{55}$/)
  assert.match(bob.publicKey, /^G[A-Z2-7]{55}$/)
  assert.match(alice.secretKey, /^S[A-Z2-7]{55}$/)
  assert.match(bob.secretKey, /^S[A-Z2-7]{55}$/)
})
