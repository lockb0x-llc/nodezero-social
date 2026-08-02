import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { fetchExact } from './fetch-exact.mjs'

function response(url, status = 200, body = 'ok') {
  return {
    status,
    url,
    async arrayBuffer() {
      return Buffer.from(body)
    },
  }
}

void test('returns bytes only for an exact HTTPS 200 response', async () => {
  const bytes = await fetchExact('https://staging.nodezero.social/health', {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://staging.nodezero.social/health')
      assert.equal(options.redirect, 'error')
      return response(url, 200, '{"ok":true}')
    },
  })
  assert.equal(bytes.toString(), '{"ok":true}')
})

void test('rejects redirects, non-200 responses, and non-HTTPS URLs', async () => {
  await assert.rejects(
    fetchExact('https://staging.nodezero.social/asset', {
      fetchImpl: async () => response('https://other.example/asset'),
    }),
    /URL mismatch/
  )
  await assert.rejects(
    fetchExact('https://staging.nodezero.social/asset', {
      fetchImpl: async (url) => response(url, 204),
    }),
    /HTTP 200/
  )
  await assert.rejects(fetchExact('http://staging.nodezero.social/asset'), /requires HTTPS/)
})

void test('forwards bounded request metadata without exposing it in the URL', async () => {
  await fetchExact('https://api.nodezero.social/warmup', {
    method: 'POST',
    body: '{"email":"qa@example.invalid"}',
    headers: { 'content-type': 'application/json' },
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'POST')
      assert.equal(options.body, '{"email":"qa@example.invalid"}')
      assert.equal(options.headers['content-type'], 'application/json')
      return response(url)
    },
  })
})
