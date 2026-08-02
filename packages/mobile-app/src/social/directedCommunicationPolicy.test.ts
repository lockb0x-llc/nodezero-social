import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ModerationRecord, RelationshipRecord } from '@nodezero/solid-pod-sync'
import { canReceiveDirectedCommunication } from './directedCommunicationPolicy'

const owner = 'https://owner.example/profile/card#me'
const peer = 'https://peer.example/profile/card#me'

function relationship(state: RelationshipRecord['state']): RelationshipRecord {
  return {
    version: 1,
    ownerWebId: owner,
    peerWebId: peer,
    state,
    updatedAt: '2026-08-01T12:00:00.000Z',
  }
}

void test('allows only an accepted and unblocked sender', () => {
  assert.equal(canReceiveDirectedCommunication(peer, owner, [relationship('accepted')], []), true)
  assert.equal(canReceiveDirectedCommunication(peer, owner, [relationship('legacy-connected')], []), false)
  assert.equal(canReceiveDirectedCommunication(peer, owner, [relationship('outgoing-pending')], []), false)
})

void test('block precedence denies an accepted sender', () => {
  const moderation: ModerationRecord[] = [{
    version: 1,
    ownerWebId: owner,
    subjectWebId: peer,
    action: 'block',
    reasonCode: 'user-blocked',
    createdAt: '2026-08-01T12:00:00.000Z',
  }]
  assert.equal(
    canReceiveDirectedCommunication(peer, owner, [relationship('accepted')], moderation),
    false
  )
})
