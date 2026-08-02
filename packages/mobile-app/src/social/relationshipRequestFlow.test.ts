import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  RelationshipRequestError,
  cancelRelationshipRequest,
  disconnectRelationship,
  respondToRelationshipRequest,
  sendRelationshipRequest,
  type SendRelationshipRequestInput,
} from './relationshipRequestFlow'

const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const activityId = 'https://alice.example/social/outbox/follow-bob.jsonld'
const podRoot = 'https://alice.example/'
const calls: string[] = []

function setup(overrides: Partial<SendRelationshipRequestInput> = {}): SendRelationshipRequestInput {
  calls.length = 0
  return {
    podRoot,
    ownerWebId: alice,
    recipientWebId: bob,
    provisionerUrl: 'https://api.nodezero.example',
    now: new Date('2026-08-01T12:00:00.000Z'),
    activityId,
    authFetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        activity?: { '@context'?: string; published?: string; publishedAt?: string }
      }
      calls.push(`deliver:${
        body.activity?.['@context'] === 'https://www.w3.org/ns/activitystreams' &&
        typeof body.activity.published === 'string' &&
        body.activity.publishedAt === undefined &&
        String(init?.body).includes(activityId)
      }`)
      return new Response(JSON.stringify({
        activityId,
        recipientWebId: bob,
        status: 201,
        inboxUrl: 'https://bob.example/social/inbox/',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    managers: {
      relationshipManager: {
        getRelationship: async () => null,
        transitionRelationship: async (_root, input) => {
          calls.push(`transition:${input.to}`)
          return {
            version: 1,
            ownerWebId: alice,
            peerWebId: input.peerWebId,
            state: input.to,
            updatedAt: input.updatedAt ?? '',
            ...(input.activityId ? { activityId: input.activityId } : {}),
          }
        },
      },
      moderationManager: { isBlocked: async () => false },
      relationshipOutboxManager: {
        writeActivity: async (_root, activity) => {
          calls.push(`outbox:${activity.id}`)
          return activity
        },
        readActivity: async () => null,
      },
      deliveryReceiptManager: {
        recordDeliveryReceipt: async (_root, receipt) => {
          calls.push(`receipt:${receipt.status}:${receipt.errorCode ?? ''}`)
          return receipt
        },
      },
      relationshipFoafProjector: {
        project: async (_root, relationship) => {
          calls.push(`project:${relationship.state}`)
          return { action: 'removed' as const, peerWebId: relationship.peerWebId }
        },
      },
    } as SendRelationshipRequestInput['managers'],
    ...overrides,
  }
}

void test('persists one Follow, transitions pending, delivers it, and records receipts', async () => {
  const result = await sendRelationshipRequest(setup())

  assert.equal(result.activity.id, activityId)
  assert.equal(result.relationship.state, 'outgoing-pending')
  assert.deepEqual(calls, [
    `outbox:${activityId}`,
    'transition:outgoing-pending',
    'receipt:pending:',
    'deliver:true',
    'receipt:delivered:',
  ])
})

void test('records a failed receipt when explicit inbox delivery fails', async () => {
  const input = setup({
    authFetch: async () => new Response(JSON.stringify({
      error: 'Recipient inbox unavailable.',
      code: 'inbox_unavailable',
    }), { status: 422, headers: { 'content-type': 'application/json' } }),
  })

  await assert.rejects(
    sendRelationshipRequest(input),
    (error: unknown) => error instanceof RelationshipRequestError && error.code === 'inbox_unavailable'
  )
  assert.deepEqual(calls.slice(-2), ['receipt:pending:', 'receipt:failed:inbox_unavailable'])
})

void test('retries a pending request with the original immutable outbox activity', async () => {
  const input = setup()
  input.managers.relationshipManager.getRelationship = async () => ({
    version: 1,
    ownerWebId: alice,
    peerWebId: bob,
    state: 'outgoing-pending',
    updatedAt: '2026-08-01T11:00:00.000Z',
    activityId,
  })
  input.managers.relationshipOutboxManager.readActivity = async () => ({
    version: 1,
    id: activityId,
    type: 'Follow',
    actor: alice,
    object: bob,
    publishedAt: '2026-08-01T11:00:00.000Z',
  })

  const result = await sendRelationshipRequest(input)

  assert.equal(result.activity.id, activityId)
  assert.deepEqual(calls, ['receipt:pending:', 'deliver:true', 'receipt:delivered:'])
})

void test('rejects accepted and blocked recipients before outbox mutation', async () => {
  const accepted = setup()
  accepted.managers.relationshipManager.getRelationship = async () => ({
    version: 1,
    ownerWebId: alice,
    peerWebId: bob,
    state: 'accepted',
    updatedAt: '2026-08-01T11:00:00.000Z',
  })
  await assert.rejects(sendRelationshipRequest(accepted))
  assert.deepEqual(calls, [])

  const blocked = setup()
  blocked.managers.moderationManager.isBlocked = async () => true
  await assert.rejects(
    sendRelationshipRequest(blocked),
    (error: unknown) => error instanceof RelationshipRequestError && error.code === 'recipient_blocked'
  )
  assert.deepEqual(calls, [])
})

void test('disconnects accepted relationships through one correlated Undo delivery', async () => {
  const input = setup()
  input.managers.relationshipManager.getRelationship = async () => ({
    version: 1,
    ownerWebId: alice,
    peerWebId: bob,
    state: 'accepted',
    updatedAt: '2026-08-01T11:00:00.000Z',
    activityId: 'https://bob.example/social/outbox/accept-alice.jsonld',
  })

  const result = await disconnectRelationship(input)

  assert.equal(result.state, 'disconnected')
  assert.deepEqual(calls, [
    `outbox:${activityId}`,
    'transition:disconnected',
    'project:disconnected',
    'receipt:pending:',
    'deliver:true',
    'receipt:delivered:',
  ])
})

void test('keeps local disconnect authoritative when remote Undo delivery fails', async () => {
  const input = setup({
    authFetch: async () => new Response(JSON.stringify({
      error: 'Recipient inbox unavailable.',
      code: 'inbox_unavailable',
    }), { status: 422, headers: { 'content-type': 'application/json' } }),
  })
  input.managers.relationshipManager.getRelationship = async () => ({
    version: 1,
    ownerWebId: alice,
    peerWebId: bob,
    state: 'accepted',
    updatedAt: '2026-08-01T11:00:00.000Z',
    activityId: 'https://bob.example/social/outbox/accept-alice.jsonld',
  })

  const result = await disconnectRelationship(input)

  assert.equal(result.state, 'disconnected')
  assert.deepEqual(calls, [
    `outbox:${activityId}`,
    'transition:disconnected',
    'project:disconnected',
    'receipt:pending:',
    'receipt:failed:inbox_unavailable',
  ])
})

void test('disconnects legacy links locally without fabricating remote activity history', async () => {
  const input = setup()
  input.managers.relationshipManager.getRelationship = async () => ({
    version: 1,
    ownerWebId: alice,
    peerWebId: bob,
    state: 'legacy-connected',
    updatedAt: '2026-08-01T11:00:00.000Z',
  })

  const result = await disconnectRelationship(input)

  assert.equal(result.state, 'disconnected')
  assert.deepEqual(calls, ['transition:disconnected', 'project:disconnected'])
})

void test('cancels an outgoing request through one correlated Undo delivery', async () => {
  const input = setup()
  input.managers.relationshipManager.getRelationship = async () => ({
    version: 1,
    ownerWebId: alice,
    peerWebId: bob,
    state: 'outgoing-pending',
    updatedAt: '2026-08-01T11:00:00.000Z',
    activityId: 'https://alice.example/social/outbox/follow-bob.jsonld',
  })

  const result = await cancelRelationshipRequest(input)

  assert.equal(result.state, 'cancelled')
  assert.deepEqual(calls, [
    `outbox:${activityId}`,
    'receipt:pending:',
    'deliver:true',
    'transition:cancelled',
    'receipt:delivered:',
  ])
})

void test('accepts a correlated incoming request and projects compatibility state', async () => {
  const input = setup()
  input.managers.relationshipManager.getRelationship = async () => ({
    version: 1,
    ownerWebId: alice,
    peerWebId: bob,
    state: 'incoming-pending',
    updatedAt: '2026-08-01T11:00:00.000Z',
    activityId: 'https://bob.example/social/outbox/follow-alice.jsonld',
  })

  const result = await respondToRelationshipRequest({ ...input, decision: 'accept' })

  assert.equal(result.state, 'accepted')
  assert.deepEqual(calls, [
    `outbox:${activityId}`,
    'receipt:pending:',
    'deliver:true',
    'transition:accepted',
    'project:accepted',
    'receipt:delivered:',
  ])
})

void test('rejects a correlated incoming request without creating foaf:knows', async () => {
  const input = setup()
  input.managers.relationshipManager.getRelationship = async () => ({
    version: 1,
    ownerWebId: alice,
    peerWebId: bob,
    state: 'incoming-pending',
    updatedAt: '2026-08-01T11:00:00.000Z',
    activityId: 'https://bob.example/social/outbox/follow-alice.jsonld',
  })

  const result = await respondToRelationshipRequest({ ...input, decision: 'reject' })

  assert.equal(result.state, 'rejected')
  assert.equal(calls.includes('project:rejected'), false)
})

void test('does not answer missing, uncorrelated, or blocked incoming requests', async () => {
  const missing = setup()
  await assert.rejects(
    respondToRelationshipRequest({ ...missing, decision: 'accept' }),
    (error: unknown) =>
      error instanceof RelationshipRequestError && error.code === 'incoming_request_unavailable'
  )
  assert.deepEqual(calls, [])

  const blocked = setup()
  blocked.managers.relationshipManager.getRelationship = async () => ({
    version: 1,
    ownerWebId: alice,
    peerWebId: bob,
    state: 'incoming-pending',
    updatedAt: '2026-08-01T11:00:00.000Z',
    activityId: 'https://bob.example/social/outbox/follow-alice.jsonld',
  })
  blocked.managers.moderationManager.isBlocked = async () => true
  await assert.rejects(
    respondToRelationshipRequest({ ...blocked, decision: 'reject' }),
    (error: unknown) => error instanceof RelationshipRequestError && error.code === 'recipient_blocked'
  )
  assert.deepEqual(calls, [])
})
