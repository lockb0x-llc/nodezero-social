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
  assert.equal(challenge.stellarPublicKey, 'GAUMNOPBK5WYUGIV2VH7JXMHACFSB4QV4HCJM5LB7ERUYKUN6UEZGEYI')
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

void test('bootstrap challenge: issue/consume round-trip preserves bindings', () => {
  const store = new ProvisionStore()
  const challenge = store.issueChallenge({
    handle: 'qa',
    webId: 'https://solid.nodezero.social/qa/profile/card#me',
    podUrl: 'https://solid.nodezero.social/qa/',
  })

  const consumed = store.consumeChallenge(challenge.challengeId)
  assert.ok(consumed)
  assert.equal(consumed.handle, 'qa')
  assert.equal(consumed.webId, 'https://solid.nodezero.social/qa/profile/card#me')

  assert.equal(store.consumeChallenge(challenge.challengeId), null)
})

void test('jobs: pending -> ready lifecycle', () => {
  const store = new ProvisionStore()
  const jobId = store.createPendingJob()
  assert.equal(store.getJob(jobId)?.status, 'pending')

  store.resolveJob(jobId, {
    handle: 'qa',
    webId: 'https://solid.nodezero.social/qa/profile/card#me',
    podUrl: 'https://solid.nodezero.social/qa/',
    issuer: 'https://staging.nodezero.social',
    stellarPublicKey: 'GAUMNOPBK5WYUGIV2VH7JXMHACFSB4QV4HCJM5LB7ERUYKUN6UEZGEYI',
    challengeId: 'ch-1',
    claimHash: 'abc',
    proofHashHex: 'def',
    proofRootHex: '123',
  })
  assert.equal(store.getJob(jobId)?.status, 'ready')

  store.failJob(jobId, 'boom')
  assert.equal(store.getJob(jobId)?.status, 'error')
})
