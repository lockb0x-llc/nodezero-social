import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { walletBrokerOrigin } from './brokerProtocol.js'

void test('wallet broker accepts only the dedicated first-party broker origin', () => {
  assert.equal(walletBrokerOrigin('https://wallet.nodezero.social'), 'https://wallet.nodezero.social')
  assert.equal(walletBrokerOrigin('https://wallet.nodezero.social/wallet-broker'), 'https://wallet.nodezero.social')
})

void test('wallet broker rejects non-first-party and non-HTTPS origins', () => {
  assert.throws(() => walletBrokerOrigin('https://staging.nodezero.social'))
  assert.throws(() => walletBrokerOrigin('http://wallet.nodezero.social'))
  assert.throws(() => walletBrokerOrigin('https://wallet.nodezero.social.example.invalid'))
})