import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { derivePersonActionPolicy } from './personActionPolicy'

void test('accepted and unblocked relationships enable directed actions', () => {
  const policy = derivePersonActionPolicy({
    isSelf: false,
    relationshipState: 'accepted',
    blocked: false,
    inTrustCircle: false,
  })
  assert.equal(policy.canMessage, true)
  assert.equal(policy.canAddTrustCircle, true)
  assert.equal(policy.canDisconnect, true)
  assert.equal(policy.reason, 'accepted')
})

void test('legacy and reveal state never grant directed messaging', () => {
  const legacy = derivePersonActionPolicy({
    isSelf: false,
    relationshipState: 'legacy-connected',
    blocked: false,
    inTrustCircle: false,
    mutuallyRevealed: true,
  })
  assert.equal(legacy.canMessage, false)
  assert.equal(legacy.canAddTrustCircle, false)
  assert.equal(legacy.canDisconnect, true)
  assert.equal(legacy.reason, 'legacy')

  const revealed = derivePersonActionPolicy({
    isSelf: false,
    relationshipState: null,
    blocked: false,
    inTrustCircle: false,
    mutuallyRevealed: true,
  })
  assert.equal(revealed.canMessage, false)
  assert.equal(revealed.canRequest, true)
})

void test('block precedence disables every directed and relationship action', () => {
  const policy = derivePersonActionPolicy({
    isSelf: false,
    relationshipState: 'accepted',
    blocked: true,
    inTrustCircle: true,
  })
  assert.equal(policy.canMessage, false)
  assert.equal(policy.canDisconnect, false)
  assert.equal(policy.canRemoveTrustCircle, false)
  assert.equal(policy.reason, 'blocked')
})

void test('pending state exposes cancellation but not messaging', () => {
  const policy = derivePersonActionPolicy({
    isSelf: false,
    relationshipState: 'outgoing-pending',
    blocked: false,
    inTrustCircle: false,
  })
  assert.equal(policy.canCancelRequest, true)
  assert.equal(policy.canRequest, false)
  assert.equal(policy.canMessage, false)
})

void test('incoming pending state must be answered rather than cancelled', () => {
  const policy = derivePersonActionPolicy({
    isSelf: false,
    relationshipState: 'incoming-pending',
    blocked: false,
    inTrustCircle: false,
  })
  assert.equal(policy.canCancelRequest, false)
  assert.equal(policy.canAcceptRequest, true)
  assert.equal(policy.canDeclineRequest, true)
  assert.equal(policy.canMessage, false)
})
