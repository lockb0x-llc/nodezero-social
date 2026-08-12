import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { ProvisionStore } from './store.js'

void test('stellar challenge: issue returns nonce + expiry bound to the key', () => {
  const store = new ProvisionStore()
  const challenge = store.issueStellarChallenge({
    stellarPublicKey: 'GAUMNOPBK5WYUGIV2VH7JXMHACFSB4QV4HCJM5LB7ERUYKUN6UEZGEYI',
  })

  assert.ok(challenge.challengeId)
  assert.ok(challenge.nonce.length >= 16)
  assert.equal(
    challenge.stellarPublicKey,
    'GAUMNOPBK5WYUGIV2VH7JXMHACFSB4QV4HCJM5LB7ERUYKUN6UEZGEYI'
  )
  assert.ok(new Date(challenge.expiresAt).getTime() > Date.now())
})

void test('stellar challenge: consume is single-use', () => {
  const store = new ProvisionStore()
  const challenge = store.issueStellarChallenge({
    stellarPublicKey: 'GAUMNOPBK5WYUGIV2VH7JXMHACFSB4QV4HCJM5LB7ERUYKUN6UEZGEYI',
  })

  const first = store.consumeStellarChallenge(challenge.challengeId)
  assert.ok(first)
  assert.equal(first.nonce, challenge.nonce)

  const second = store.consumeStellarChallenge(challenge.challengeId)
  assert.equal(second, null)
})

void test('stellar challenge: unknown id yields null', () => {
  const store = new ProvisionStore()
  assert.equal(store.consumeStellarChallenge('nope'), null)
})
