import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createProvisionerRelationshipSenderVerifier } from './relationshipSenderVerifier'

const payload = {
  '@context': 'https://www.w3.org/ns/activitystreams',
  id: 'https://alice.example/social/outbox/follow-bob',
  type: 'Follow',
}

void test('returns the actor from recipient-authenticated provisioner verification', async () => {
  let requestedUrl = ''
  let requestedBody = ''
  const verifier = createProvisionerRelationshipSenderVerifier({
    provisionerUrl: 'https://api.nodezero.example/',
    authFetch: async (url, init) => {
      requestedUrl = String(url)
      requestedBody = String(init?.body)
      return new Response(JSON.stringify({
        actorWebId: 'https://alice.example/profile/card#me',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })

  assert.equal(await verifier.verifySender({
    activity: {
      version: 1,
      id: payload.id,
      type: 'Follow',
      actor: 'https://alice.example/profile/card#me',
      object: 'https://bob.example/profile/card#me',
      publishedAt: '2026-08-01T12:00:00.000Z',
    },
    payload,
  }), 'https://alice.example/profile/card#me')
  assert.equal(
    requestedUrl,
    'https://api.nodezero.example/v1/social/relationship-delivery/verify'
  )
  assert.deepEqual(JSON.parse(requestedBody), { activity: payload })
})

void test('fails closed on missing configuration, rejection, malformed response, or network error', async () => {
  const activity = {
    version: 1 as const,
    id: 'https://alice.example/social/outbox/follow-bob',
    type: 'Follow' as const,
    actor: 'https://alice.example/profile/card#me',
    object: 'https://bob.example/profile/card#me',
    publishedAt: '2026-08-01T12:00:00.000Z',
  }
  const missing = createProvisionerRelationshipSenderVerifier({
    provisionerUrl: '',
    authFetch: async () => { throw new Error('must not run') },
  })
  assert.equal(await missing.verifySender({ activity, payload }), null)

  for (const authFetch of [
    async (): Promise<Response> => new Response('{}', { status: 422 }),
    async (): Promise<Response> => new Response('{}', { status: 200 }),
    async (): Promise<Response> => { throw new Error('offline') },
  ]) {
    const verifier = createProvisionerRelationshipSenderVerifier({
      provisionerUrl: 'https://api.nodezero.example',
      authFetch,
    })
    assert.equal(await verifier.verifySender({ activity, payload }), null)
  }
})
