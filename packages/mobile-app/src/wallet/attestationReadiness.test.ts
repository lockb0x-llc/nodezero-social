import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isWalletReadyForAttestation } from './attestationReadiness.js'

void test('blocks attestation while the wallet is loading', () => {
  assert.equal(isWalletReadyForAttestation(true, 'GDEVICE'), false)
})

void test('blocks attestation until a wallet public key exists', () => {
  assert.equal(isWalletReadyForAttestation(false, null), false)
})

void test('starts attestation only after wallet initialization completes', () => {
  assert.equal(isWalletReadyForAttestation(false, 'GDEVICE'), true)
})