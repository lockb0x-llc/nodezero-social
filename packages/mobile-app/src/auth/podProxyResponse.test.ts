import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { exposeLogicalResponseUrl } from './podProxyResponse'

void test('exposes the logical Pod URL without changing response behavior', async () => {
  const response = new Response('profile', {
    status: 200,
    headers: { etag: '"profile-1"' },
  })
  Object.defineProperty(response, 'url', {
    configurable: true,
    value: 'https://api.nodezero.social/v1/pod-proxy/alice/profile/card',
  })

  const normalized = exposeLogicalResponseUrl(
    response,
    'https://solid.nodezero.social/alice/profile/card'
  )

  assert.equal(normalized, response)
  assert.equal(normalized instanceof Response, true)
  assert.equal(normalized.url, 'https://solid.nodezero.social/alice/profile/card')
  assert.equal(normalized.status, 200)
  assert.equal(normalized.headers.get('etag'), '"profile-1"')
  assert.equal(await normalized.clone().text(), 'profile')
  assert.equal(await normalized.text(), 'profile')
})
