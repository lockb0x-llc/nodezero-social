import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionClaims } from './sessionTokens.js'
import {
  RelationshipDeliveryError,
  deliverRelationshipActivity,
} from './relationshipDelivery.js'
import { RELATIONSHIP_DELIVERY_ASSERTION_PROPERTY } from './relationshipDeliveryAssertions.js'

const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const bobProfile = 'https://bob.example/profile/card'
const bobInbox = 'https://bob.example/social/inbox/'
const activityId = 'https://alice.example/social/outbox/follow-bob'

const claims: SessionClaims = {
  sub: alice,
  pod: 'https://alice.example/',
  spk: null,
  aud: 'nz-session-v1',
  iss: 'https://api.nodezero.social',
  iat: 1,
  exp: 2,
  jti: 'test',
}

const follow = {
  '@context': 'https://www.w3.org/ns/activitystreams',
  id: activityId,
  type: 'Follow',
  actor: alice,
  object: bob,
  published: '2026-08-01T12:00:00.000Z',
}

function profileFetch(inboxUrl: string | null): typeof globalThis.fetch {
  return (input) => {
    assert.equal(String(input), bobProfile)
    const inboxTriple = inboxUrl
      ? `<${bob}> <http://www.w3.org/ns/ldp#inbox> <${inboxUrl}> .`
      : `<${bob}> a <http://xmlns.com/foaf/0.1/Person> .`
    const response = new Response(inboxTriple, {
      status: 200,
      headers: { 'content-type': 'text/turtle' },
    })
    Object.defineProperty(response, 'url', { value: bobProfile })
    return Promise.resolve(response)
  }
}

void test('delivers an authenticated Follow to the discovered recipient inbox', async () => {
  let postedBody = ''
  const result = await deliverRelationshipActivity(
    claims,
    { recipientWebId: bob, activity: follow },
    {
      publicFetch: profileFetch(bobInbox),
      assertionManager: { issue: () => 'signed-delivery-assertion' },
      postActivity: (url, body, contentType) => {
        assert.equal(url, bobInbox)
        assert.equal(contentType, 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"')
        postedBody = body.toString('utf8')
        return Promise.resolve({
          finalUrl: bobInbox,
          status: 201,
          location: 'https://bob.example/social/inbox/activity-1',
        })
      },
    }
  )

  assert.equal(result.status, 201)
  assert.equal(result.activityId, activityId)
  assert.match(postedBody, /"type":"Follow"/)
  assert.match(postedBody, /alice\.example\/profile\/card#me/)
  assert.equal(
    (JSON.parse(postedBody) as Record<string, unknown>)[RELATIONSHIP_DELIVERY_ASSERTION_PROPERTY],
    'signed-delivery-assertion'
  )
})

void test('rejects actor and Follow recipient mismatches before discovery', async () => {
  let discoveryCalls = 0
  const publicFetch: typeof globalThis.fetch = () => {
    discoveryCalls += 1
    return Promise.reject(new Error('must not run'))
  }

  await assert.rejects(
    deliverRelationshipActivity(
      claims,
      { recipientWebId: bob, activity: { ...follow, actor: 'https://mallory.example/profile/card#me' } },
      { publicFetch }
    ),
    (error: unknown) => error instanceof RelationshipDeliveryError && error.code === 'actor_mismatch'
  )
  await assert.rejects(
    deliverRelationshipActivity(
      claims,
      { recipientWebId: bob, activity: { ...follow, object: 'https://carol.example/profile/card#me' } },
      { publicFetch }
    ),
    (error: unknown) => error instanceof RelationshipDeliveryError && error.code === 'recipient_mismatch'
  )
  assert.equal(discoveryCalls, 0)
})

void test('rejects private Block delivery before discovery', async () => {
  let discoveryCalls = 0
  await assert.rejects(
    deliverRelationshipActivity(
      claims,
      {
        recipientWebId: bob,
        activity: { ...follow, type: 'Block' },
      },
      {
        publicFetch: () => {
          discoveryCalls += 1
          return Promise.reject(new Error('must not run'))
        },
      }
    ),
    (error: unknown) => error instanceof RelationshipDeliveryError && error.code === 'block_not_delivered'
  )
  assert.equal(discoveryCalls, 0)
})

void test('rejects recipients without an advertised inbox', async () => {
  await assert.rejects(
    deliverRelationshipActivity(
      claims,
      { recipientWebId: bob, activity: follow },
      { publicFetch: profileFetch(null) }
    ),
    (error: unknown) => error instanceof RelationshipDeliveryError && error.code === 'inbox_unavailable'
  )
})

void test('rejects invalid recipient WebIDs and malformed activities', async () => {
  await assert.rejects(
    deliverRelationshipActivity(claims, { recipientWebId: 'http://bob.example/#me', activity: follow }),
    (error: unknown) => error instanceof RelationshipDeliveryError && error.code === 'invalid_recipient'
  )
  await assert.rejects(
    deliverRelationshipActivity(claims, { recipientWebId: bob, activity: { type: 'Follow' } }),
    (error: unknown) => error instanceof RelationshipDeliveryError && error.code === 'invalid_activity'
  )
})
