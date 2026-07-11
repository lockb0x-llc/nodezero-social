import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { before, test } from 'node:test'

process.env.JSS_SOLID_CSS_BASE_URL = 'https://solid.nodezero.social'
process.env.JSS_ISSUER_URL = 'https://staging.nodezero.social'

let createRequestHandler: () => (req: IncomingMessage, res: ServerResponse) => void

before(async () => {
  const mod = await import('./index.js')
  createRequestHandler = mod.createRequestHandler
})

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer(createRequestHandler())
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Failed to bind test server.')
  }

  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    return await fn(baseUrl)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

void test('/v1/solid-account returns 400 when password is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/solid-account`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        name: 'qauser',
        email: 'qauser@example.com',
        stellarPublicKey: 'GAUMNOPBK5WYUGIV2VH7JXMHACFSB4QV4HCJM5LB7ERUYKUN6UEZGEYI',
      }),
    })

    const payload = (await response.json()) as { error?: string }
    assert.equal(response.status, 400)
    assert.equal(payload.error, 'password is required.')
  })
})

void test('/v1/solid-account returns 400 when password is too short', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/solid-account`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        name: 'qauser',
        email: 'qauser@example.com',
        password: 'short',
        stellarPublicKey: 'GAUMNOPBK5WYUGIV2VH7JXMHACFSB4QV4HCJM5LB7ERUYKUN6UEZGEYI',
      }),
    })

    const payload = (await response.json()) as { error?: string }
    assert.equal(response.status, 400)
    assert.equal(payload.error, 'password must be at least 12 characters.')
  })
})

void test('/v1/oidc-bridge/consume returns 400 when audience is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/oidc-bridge/consume`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        origin: 'https://solid.nodezero.social',
      },
      body: JSON.stringify({
        token: 'test-token',
      }),
    })

    const payload = (await response.json()) as { error?: string }
    assert.equal(response.status, 400)
    assert.equal(payload.error, 'audience is required.')
  })
})

void test('/v1/docustream/rss-fetch returns 400 when url is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/docustream/rss-fetch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({}),
    })

    const payload = (await response.json()) as { error?: string; code?: string }
    assert.equal(response.status, 400)
    assert.equal(payload.error, 'url is required.')
    assert.equal(payload.code, 'missing_url')
  })
})

void test('/v1/docustream/rss-fetch rejects blocked localhost host', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/docustream/rss-fetch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        url: 'https://localhost/feed.xml',
      }),
    })

    const payload = (await response.json()) as { error?: string; code?: string }
    assert.equal(response.status, 400)
    assert.equal(payload.code, 'blocked_host')
    assert.equal(payload.error, 'Feed host is not allowed.')
  })
})

void test('/v1/docustream/rss-fetch returns XML payload when upstream succeeds', async () => {
  const originalFetch = globalThis.fetch
  const feedXml = '<?xml version="1.0"?><rss><channel><title>Test Feed</title></channel></rss>'
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith('http://127.0.0.1:')) {
      return originalFetch(input, init)
    }

    return new Response(feedXml, {
      status: 200,
      headers: {
        'content-type': 'application/rss+xml; charset=utf-8',
        'content-length': String(Buffer.byteLength(feedXml, 'utf8')),
      },
    })
  }) as typeof fetch

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/docustream/rss-fetch`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          url: 'https://www.w3.org/news/feed/',
        }),
      })

      const payload = (await response.json()) as { url?: string; xml?: string }
      assert.equal(response.status, 200)
      assert.equal(payload.url, 'https://www.w3.org/news/feed/')
      assert.equal(payload.xml, feedXml)
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
