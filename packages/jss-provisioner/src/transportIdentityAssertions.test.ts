import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { TransportIdentityAssertionManager } from './transportIdentityAssertions.js'
import type { SessionClaims } from './sessionTokens.js'

const webId = 'https://alice.example/profile/card#me'
const stellarPublicKey = `G${'A'.repeat(55)}`
const now = new Date('2026-08-01T12:00:00.000Z')
const claims: SessionClaims = {
  sub: webId,
  pod: 'https://alice.example/',
  spk: stellarPublicKey,
  aud: 'nz-session-v1',
  iss: 'https://staging.nodezero.social',
  iat: 0,
  exp: 9_999_999_999,
  jti: 'session',
}

void test('binds transport assertion to WebID, Stellar key, audience, and expiry', () => {
  const manager = new TransportIdentityAssertionManager({
    signingKey: 'transport-test-signing-key-32-bytes!',
    issuer: 'https://staging.nodezero.social',
    ttlMs: 60_000,
  })
  const assertion = manager.issue(claims, 'waku', now)
  assert.equal(manager.verify({ assertion, audience: 'waku', webId, stellarPublicKey, now }), true)
  assert.deepEqual(manager.readVerified(assertion, 'waku', now), {
    webId,
    accountWebId: webId,
    stellarPublicKey,
    audience: 'waku',
  })
  assert.equal(manager.verify({ assertion, audience: 'relay', webId, stellarPublicKey, now }), false)
  assert.equal(manager.verify({ assertion, audience: 'waku', webId: `${webId}-other`, stellarPublicKey, now }), false)
  assert.equal(manager.verify({ assertion, audience: 'waku', webId, stellarPublicKey: `G${'B'.repeat(55)}`, now }), false)
  assert.equal(manager.verify({ assertion, audience: 'waku', webId, stellarPublicKey, now: new Date(now.getTime() + 60_001) }), false)
  assert.equal(Buffer.from(assertion, 'base64url').toString('utf8').includes(webId), false)
  const presenceCommitment = createHash('sha256')
    .update(`${webId}:2026-08-01T12`)
    .digest('base64url')
  const presenceSubject = `urn:nodezero:presence:${presenceCommitment}`
  const presenceAssertion = manager.issue(claims, 'waku', now, presenceSubject)
  assert.equal(manager.verify({
    assertion: presenceAssertion,
    audience: 'waku',
    webId: presenceSubject,
    stellarPublicKey,
    now,
  }), true)
  assert.throws(() => manager.issue(claims, 'relay', now, presenceSubject))
  assert.throws(() => manager.issue(
    claims,
    'waku',
    now,
    `urn:nodezero:presence:${'a'.repeat(43)}`
  ))
})
