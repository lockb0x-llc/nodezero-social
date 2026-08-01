import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  RelationshipSenderVerificationUnavailableError,
  createProvisionerRelationshipSenderVerifier,
} from './relationshipSenderVerifier'

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

void test('returns null only for deterministic assertion rejection', async () => {
  const activity = {
    version: 1 as const,
    id: 'https://alice.example/social/outbox/follow-bob',
    type: 'Follow' as const,
    actor: 'https://alice.example/profile/card#me',
    object: 'https://bob.example/profile/card#me',
    publishedAt: '2026-08-01T12:00:00.000Z',
  }
  const rejected = createProvisionerRelationshipSenderVerifier({
    provisionerUrl: 'https://api.nodezero.example',
    authFetch: async () => new Response('{}', { status: 422 }),
  })
  assert.equal(await rejected.verifySender({ activity, payload }), null)
})

void test('marks configuration, network, throttling, server, and malformed responses retryable', async () => {
  const activity = {
    version: 1 as const,
    id: 'https://alice.example/social/outbox/follow-bob',
    type: 'Follow' as const,
    actor: 'https://alice.example/profile/card#me',
    object: 'https://bob.example/profile/card#me',
    publishedAt: '2026-08-01T12:00:00.000Z',
  }

  const verifiers = [
    createProvisionerRelationshipSenderVerifier({
      provisionerUrl: '',
      authFetch: async () => { throw new Error('must not run') },
    }),
    ...[
    async (): Promise<Response> => new Response('{}', { status: 200 }),
    async (): Promise<Response> => new Response('{}', { status: 429 }),
    async (): Promise<Response> => new Response('{}', { status: 503 }),
    async (): Promise<Response> => { throw new Error('offline') },
    ].map((authFetch) => createProvisionerRelationshipSenderVerifier({
      provisionerUrl: 'https://api.nodezero.example',
      authFetch,
    })),
  ]
  for (const verifier of verifiers) {
    await assert.rejects(
      verifier.verifySender({ activity, payload }),
      (error: unknown) =>
        error instanceof RelationshipSenderVerificationUnavailableError && error.retryable
    )
  }
})
