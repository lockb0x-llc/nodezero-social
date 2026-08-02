import assert from 'node:assert/strict'
import test from 'node:test'
import { PublicPeerProfileError, readPublicPeerProfile } from './publicPeerProfile.js'

const webId = 'https://alice.example/profile/card#me'

void test('reads public peer profile without an authorization input', async () => {
  let authorization = ''
  const result = await readPublicPeerProfile(webId, {
    publicFetch: (input, init): Promise<Response> => {
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      const response = new Response(`
        @prefix foaf: <http://xmlns.com/foaf/0.1/> .
        @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
        <${webId}> a foaf:Person ; foaf:name "Alice" ; vcard:note "Public bio" .
      `, { status: 200, headers: { 'content-type': 'text/turtle' } })
      Object.defineProperty(response, 'url', { value: String(input) })
      return Promise.resolve(response)
    },
  })

  assert.equal(authorization, '')
  assert.equal(result.authenticated, false)
  assert.equal(result.profile?.displayName, 'Alice')
})

void test('rejects malformed and non-https WebIDs before fetch', async () => {
  let fetchCalls = 0
  await assert.rejects(
    readPublicPeerProfile('http://alice.example/profile/card#me', {
      publicFetch: () => {
        fetchCalls += 1
        return Promise.reject(new Error('must not run'))
      },
    }),
    (error: unknown) => error instanceof PublicPeerProfileError && error.code === 'invalid_webid'
  )
  assert.equal(fetchCalls, 0)
})
