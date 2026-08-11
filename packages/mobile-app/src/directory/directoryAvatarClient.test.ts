import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readDirectoryAvatarDataUri } from './directoryAvatarClient'

void test('loads avatar bytes only through the authenticated provisioner endpoint', async () => {
  let requestedUrl = ''
  const uri = await readDirectoryAvatarDataUri({
    provisionerUrl: 'https://api.nodezero.example/',
    webId: 'https://solid.example/alice/profile/card#me',
    authFetch: (input, init): Promise<Response> => {
      requestedUrl = String(input)
      assert.equal(init?.method, 'POST')
      assert.deepEqual(JSON.parse(String(init?.body)), {
        webId: 'https://solid.example/alice/profile/card#me',
      })
      return Promise.resolve(
        new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
    },
  })
  assert.equal(requestedUrl, 'https://api.nodezero.example/v1/community-directory/avatar')
  assert.equal(uri, 'data:image/png;base64,AQID')
})

void test('retries a transient cross-replica avatar miss', async () => {
  let attempts = 0
  const uri = await readDirectoryAvatarDataUri({
    provisionerUrl: 'https://api.nodezero.example',
    webId: 'https://solid.nodezero.example/alice/profile/card#me',
    authFetch: async () => {
      attempts += 1
      return attempts === 1
        ? new Response('', { status: 404 })
        : new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          })
    },
  })

  assert.equal(attempts, 2)
  assert.equal(uri, 'data:image/png;base64,AQID')
})

void test('does not retry a permanent avatar content rejection', async () => {
  let attempts = 0
  const uri = await readDirectoryAvatarDataUri({
    provisionerUrl: 'https://api.nodezero.example',
    webId: 'https://solid.nodezero.example/alice/profile/card#me',
    authFetch: async () => {
      attempts += 1
      return new Response('', { status: 403 })
    },
  })

  assert.equal(uri, null)
  assert.equal(attempts, 1)
})

for (const [label, responseFactory] of [
  ['rate limit', () => new Response('', { status: 429 })],
  ['server error', () => new Response('', { status: 503 })],
  ['transport failure', () => Promise.reject(new Error('network unavailable'))],
] as const) {
  void test(`exhausts bounded retries for ${label}`, async () => {
    let attempts = 0
    const uri = await readDirectoryAvatarDataUri({
      provisionerUrl: 'https://api.nodezero.example',
      webId: 'https://solid.nodezero.example/alice/profile/card#me',
      authFetch: async () => {
        attempts += 1
        return responseFactory()
      },
    })
    assert.equal(uri, null)
    assert.equal(attempts, 3)
  })
}

void test('fails closed for unsupported, oversized, or unavailable avatars', async () => {
  assert.equal(
    await readDirectoryAvatarDataUri({
      provisionerUrl: 'https://api.nodezero.example',
      webId: 'x',
      authFetch: async () => new Response('text', { headers: { 'content-type': 'text/plain' } }),
    }),
    null
  )
  assert.equal(
    await readDirectoryAvatarDataUri({
      provisionerUrl: 'https://api.nodezero.example',
      webId: 'x',
      authFetch: async () =>
        new Response(new Uint8Array(512 * 1024 + 1), {
          headers: { 'content-type': 'image/png' },
        }),
    }),
    null
  )
})
