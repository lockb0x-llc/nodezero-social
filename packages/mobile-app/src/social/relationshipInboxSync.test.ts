import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { SyncRelationshipInboxInput } from './relationshipInboxSync'
import { syncRelationshipInbox } from './relationshipInboxSync'

const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const sourceUrl = 'https://bob.example/social/inbox/activity-1'
const now = new Date('2026-08-01T12:01:00.000Z')
const payload = {
  '@context': 'https://www.w3.org/ns/activitystreams',
  id: 'https://alice.example/social/outbox/follow-bob',
  type: 'Follow',
  actor: alice,
  object: bob,
  published: '2026-08-01T12:00:00.000Z',
  'https://nodezero.social/ns#deliveryAssertion': 'signed',
}

function setup(enabled: boolean): SyncRelationshipInboxInput {
  return {
    podRoot: 'https://bob.example/',
    recipientWebId: bob,
    provisionerUrl: 'https://api.nodezero.example',
    now,
    authFetch: async () => new Response(JSON.stringify({ actorWebId: alice }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    managers: {
      discoveryConsentManager: {
        readConsent: async () => ({
          version: 1,
          ownerWebId: bob,
          publicListing: false,
          publicIndexing: false,
          nearbyPresence: false,
          inboundContactRequests: enabled,
          localBroadcasts: false,
          updatedAt: now.toISOString(),
        }),
      },
      relationshipInboxReader: {
        listResourceUrls: async () => [sourceUrl],
        readResource: async () => ({ sourceUrl, payload }),
        removeResource: async () => undefined,
      },
      relationshipInboxProcessor: {
        process: async () => ({
          status: 'processed' as const,
          activity: {
            version: 1,
            id: payload.id,
            type: 'Follow' as const,
            actor: alice,
            object: bob,
            publishedAt: payload.published,
          },
          relationship: null,
        }),
      },
      relationshipQuarantineManager: {
        quarantine: async (_root, record) => record,
      },
      relationshipManager: {
        listRelationships: async () => [{
          version: 1,
          ownerWebId: bob,
          peerWebId: alice,
          state: 'incoming-pending' as const,
          updatedAt: now.toISOString(),
          activityId: payload.id,
        }],
      },
    } as SyncRelationshipInboxInput['managers'],
  }
}

void test('does not read the public-append inbox when inbound requests are disabled', async () => {
  const input = setup(false)
  let listCalls = 0
  input.managers.relationshipInboxReader.listResourceUrls = async () => {
    listCalls += 1
    return []
  }
  const result = await syncRelationshipInbox(input)
  assert.equal(result.enabled, false)
  assert.equal(listCalls, 0)
})

void test('verifies and processes bounded inbox resources when explicitly enabled', async () => {
  const result = await syncRelationshipInbox(setup(true))
  assert.equal(result.enabled, true)
  assert.equal(result.scanned, 1)
  assert.equal(result.processed, 1)
  assert.equal(result.incomingRequests[0]?.peerWebId, alice)
})

void test('retains inbox resources when a transient read fails', async () => {
  const input = setup(true)
  let removeCalls = 0
  input.managers.relationshipInboxReader.readResource = async () => {
    throw new Error('temporary Pod read failure')
  }
  input.managers.relationshipInboxReader.removeResource = async () => {
    removeCalls += 1
  }

  const result = await syncRelationshipInbox(input)

  assert.equal(result.readFailures, 1)
  assert.equal(removeCalls, 0)
})

void test('retains inbox resources while another processor owns the replay lease', async () => {
  const input = setup(true)
  let removeCalls = 0
  input.managers.relationshipInboxProcessor.process = async () => ({
    status: 'in-progress',
    activity: {
      version: 1,
      id: payload.id,
      type: 'Follow',
      actor: alice,
      object: bob,
      publishedAt: payload.published,
    },
    relationship: null,
  })
  input.managers.relationshipInboxReader.removeResource = async () => {
    removeCalls += 1
  }

  const result = await syncRelationshipInbox(input)

  assert.equal(result.inProgress, 1)
  assert.equal(removeCalls, 0)
})
