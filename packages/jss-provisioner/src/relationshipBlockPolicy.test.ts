import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionClaims } from './sessionTokens.js'
import { isRelationshipRecipientBlocked } from './relationshipBlockPolicy.js'

const alice = 'https://solid.example/alice/profile/card#me'
const bob = 'https://solid.example/bob/profile/card#me'
const claims: SessionClaims = {
  sub: alice,
  pod: 'https://solid.example/alice/',
  spk: null,
  aud: 'nz-session-v1',
  iss: 'https://api.example',
  iat: 1,
  exp: 2,
  jti: 'test',
}

void test('reads private owner moderation state with a DPoP-bound Pod token', async () => {
  let requestedUrl = ''
  let authorization = ''
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input, init): Promise<Response> => {
    requestedUrl = String(input)
    authorization = new Headers(init?.headers).get('authorization') ?? ''
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://solid.example/alice/social/moderation/index#block-${encodeURIComponent(bob)}>
        a nz:ModerationRecord ; nz:version 1 ; nz:ownerWebId <${alice}> ;
        nz:subjectWebId <${bob}> ; nz:moderationAction "block" ;
        nz:createdAt "2026-08-01T12:00:00.000Z" .
    `
    const response = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/turtle' },
    })
    Object.defineProperty(response, 'url', { value: requestedUrl })
    return Promise.resolve(response)
  }
  try {
    const blocked = await isRelationshipRecipientBlocked(claims, bob, {
      cssBaseUrl: 'https://solid.example',
      credentialStore: {
        findByWebId: () => Promise.resolve({
          webId: alice,
          podUrl: claims.pod,
          clientCredentialsId: 'client-id',
          clientCredentialsSecret: 'client-secret',
          createdAt: '2026-08-01T00:00:00.000Z',
        }),
      },
      mintToken: () => Promise.resolve({
        accessToken: 'solid-access-token',
        expiresAtMs: Date.now() + 60_000,
        proof: (): string => 'dpop-proof',
      }),
    })
    assert.equal(blocked, true)
    assert.equal(requestedUrl, 'https://solid.example/alice/social/moderation/index')
    assert.equal(authorization, 'DPoP solid-access-token')
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('fails closed when credentials or Pod origin do not match the session', async () => {
  await assert.rejects(isRelationshipRecipientBlocked(claims, bob, {
    cssBaseUrl: 'https://solid.example',
    credentialStore: { findByWebId: () => Promise.resolve(null) },
  }))
  await assert.rejects(isRelationshipRecipientBlocked(
    { ...claims, pod: 'https://other.example/alice/' },
    bob,
    {
      cssBaseUrl: 'https://solid.example',
      credentialStore: { findByWebId: () => Promise.resolve(null) },
    }
  ))
})
