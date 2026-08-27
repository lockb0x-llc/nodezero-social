import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DeliveryReceipt, RelationshipActivity } from '@nodezero/solid-pod-sync'
import type { SyncRelationshipOutboxInput } from './relationshipOutboxSync'
import { syncRelationshipOutbox } from './relationshipOutboxSync'

const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const activityId = 'https://alice.example/social/outbox/follow-bob'
const now = new Date('2026-08-01T12:01:00.000Z')

const activity: RelationshipActivity = {
  version: 1,
  id: activityId,
  type: 'Follow',
  actor: alice,
  object: bob,
  publishedAt: '2026-08-01T12:00:00.000Z',
}

const pendingReceipt: DeliveryReceipt = {
  version: 1,
  activityId,
  senderWebId: alice,
  recipientWebId: bob,
  status: 'pending',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

function setup(receiptStatus: DeliveryReceipt['status'] = 'pending', blocked = false): SyncRelationshipOutboxInput {
  const recordedReceipts: DeliveryReceipt[] = []
  return {
    podRoot: 'https://alice.example/',
    provisionerUrl: 'https://api.nodezero.example',
    now,
    authFetch: async () => new Response(JSON.stringify({ status: 200, inboxUrl: 'https://bob.example/inbox/' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    managers: {
      deliveryReceiptManager: {
        listDeliveryReceipts: async () => [{ ...pendingReceipt, status: receiptStatus }],
        recordDeliveryReceipt: async (_root, r) => {
          recordedReceipts.push(r)
          return r
        },
      },
      relationshipOutboxManager: {
        readActivity: async (_root, id) => (id === activityId ? activity : null),
      },
      moderationManager: {
        isBlocked: async () => blocked,
      },
    } as unknown as SyncRelationshipOutboxInput['managers'],
  }
}

void test('delivers pending outbox receipts and records delivered state', async () => {
  const input = setup('pending', false)
  const result = await syncRelationshipOutbox(input)
  assert.equal(result.total, 1)
  assert.equal(result.delivered, 1)
  assert.equal(result.failed, 0)
  assert.equal(result.rejected, 0)
  assert.equal(result.results[0]?.status, 'delivered')
  assert.equal(result.results[0]?.inboxUrl, 'https://bob.example/inbox/')
})

void test('rejects delivery when recipient is blocked by owner', async () => {
  const input = setup('pending', true)
  const result = await syncRelationshipOutbox(input)
  assert.equal(result.total, 1)
  assert.equal(result.delivered, 0)
  assert.equal(result.rejected, 1)
  assert.equal(result.results[0]?.status, 'rejected')
  assert.equal(result.results[0]?.errorCode, 'recipient_blocked')
})

void test('records failure when outbox activity resource is missing', async () => {
  const input = setup('pending', false)
  input.managers.relationshipOutboxManager.readActivity = async () => null
  const result = await syncRelationshipOutbox(input)
  assert.equal(result.total, 1)
  assert.equal(result.delivered, 0)
  assert.equal(result.failed, 1)
  assert.equal(result.results[0]?.status, 'failed')
  assert.equal(result.results[0]?.errorCode, 'activity_missing')
})
