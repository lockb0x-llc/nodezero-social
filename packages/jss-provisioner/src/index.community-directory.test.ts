import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { before, test } from 'node:test'

process.env.JSS_SOLID_CSS_BASE_URL = 'https://solid.nodezero.social'
process.env.JSS_ISSUER_URL = 'https://staging.nodezero.social'
process.env.JSS_INTERNAL_API_KEY = 'test-internal-key'

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

void test('/v1/community-directory/index returns empty members initially', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/community-directory/index`, {
      headers: { accept: 'application/json' },
    })

    const payload = (await response.json()) as { version?: number; members?: unknown[] }
    assert.equal(response.status, 200)
    assert.equal(payload.version, 1)
    assert.deepEqual(payload.members, [])
  })
})

void test('/v1/community-directory/opt-in rejects unauthorized mutation', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/community-directory/opt-in`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ webId: 'https://solid.nodezero.social/demo/profile/card#me' }),
    })

    const payload = (await response.json()) as { error?: string }
    assert.equal(response.status, 401)
    assert.equal(payload.error, 'A valid x-nz-internal-key header is required.')
  })
})
