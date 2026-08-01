import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RELATIONSHIP_DELIVERY_ASSERTION_PROPERTY,
  RelationshipDeliveryAssertionManager,
  readRelationshipDeliveryAssertion,
} from './relationshipDeliveryAssertions.js'

const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const activity = {
  version: 1 as const,
  id: 'https://alice.example/social/outbox/follow-bob',
  type: 'Follow' as const,
  actor: alice,
  object: bob,
  publishedAt: '2026-08-01T12:00:00.000Z',
}
const wireActivity = {
  '@context': 'https://www.w3.org/ns/activitystreams',
  id: activity.id,
  type: activity.type,
  actor: alice,
  object: bob,
  published: activity.publishedAt,
}
const issuedAt = new Date('2026-08-01T12:01:00.000Z')

void test('issues and verifies a recipient-bound canonical activity assertion', () => {
  const manager = new RelationshipDeliveryAssertionManager({
    signingKey: 'delivery-test-key'.repeat(3),
    issuer: 'https://api.nodezero.example',
  })
  const assertion = manager.issue(activity, bob, issuedAt)

  assert.equal(manager.verify(assertion, wireActivity, bob, issuedAt), alice)
  assert.equal(manager.usesEphemeralKey, false)
})

void test('rejects tampering, a different recipient, expiry, and a foreign key', () => {
  const manager = new RelationshipDeliveryAssertionManager({
    signingKey: 'delivery-test-key'.repeat(3),
    issuer: 'https://api.nodezero.example',
    ttlMs: 60_000,
  })
  const assertion = manager.issue(activity, bob, issuedAt)

  assert.equal(manager.verify(assertion, { ...wireActivity, object: alice }, bob, issuedAt), null)
  assert.equal(manager.verify(assertion, wireActivity, alice, issuedAt), null)
  assert.equal(manager.verify(assertion, wireActivity, bob, new Date('2026-08-01T12:03:00.000Z')), null)
  assert.equal(new RelationshipDeliveryAssertionManager({
    signingKey: 'foreign-key'.repeat(4),
    issuer: 'https://api.nodezero.example',
  }).verify(assertion, wireActivity, bob, issuedAt), null)
})

void test('reads only the namespaced delivery assertion extension', () => {
  assert.equal(readRelationshipDeliveryAssertion({
    ...wireActivity,
    [RELATIONSHIP_DELIVERY_ASSERTION_PROPERTY]: 'signed-assertion',
  }), 'signed-assertion')
  assert.equal(readRelationshipDeliveryAssertion({ ...wireActivity, assertion: 'wrong' }), null)
})
