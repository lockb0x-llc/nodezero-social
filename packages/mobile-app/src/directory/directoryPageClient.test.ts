import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { fetchDirectoryPage } from './directoryPageClient'

void test('fetchDirectoryPage sends bounded pagination and captures ETag cache state', async () => {
  let requestedUrl = ''
  const result = await fetchDirectoryPage({
    endpoint: 'https://api.nodezero.example/v1/community-directory/index',
    cursor: 'https://solid.example/alice/profile/card#me',
    limit: 50,
    fetch: async (url) => {
      requestedUrl = String(url)
      return new Response(JSON.stringify({
        version: 1,
        members: [{ webId: 'https://solid.example/bob/profile/card#me' }],
        nextCursor: null,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: 'W/"page-v1"' },
      })
    },
  })

  const parsedUrl = new URL(requestedUrl)
  assert.equal(parsedUrl.searchParams.get('limit'), '50')
  assert.equal(parsedUrl.searchParams.get('cursor'), 'https://solid.example/alice/profile/card#me')
  assert.equal(result.page.members[0]?.webId, 'https://solid.example/bob/profile/card#me')
  assert.equal(result.cache?.etag, 'W/"page-v1"')
})

void test('fetchDirectoryPage reuses cached page after 304', async () => {
  let ifNoneMatch = ''
  const cachedPage = {
    version: 1 as const,
    members: [{ webId: 'https://solid.example/alice/profile/card#me' }],
    nextCursor: null,
    etag: 'W/"page-v1"',
  }
  const result = await fetchDirectoryPage({
    endpoint: 'https://api.nodezero.example/v1/community-directory/index',
    cached: { etag: 'W/"page-v1"', page: cachedPage },
    fetch: async (_url, init) => {
      ifNoneMatch = new Headers(init?.headers).get('if-none-match') ?? ''
      return new Response(null, { status: 304 })
    },
  })

  assert.equal(ifNoneMatch, 'W/"page-v1"')
  assert.equal(result.page, cachedPage)
})
