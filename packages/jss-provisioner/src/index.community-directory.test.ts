import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { SessionTokenManager } from './sessionTokens.js'
import type { CommunityDirectoryRecord } from './communityDirectory.js'

process.env.JSS_SOLID_CSS_BASE_URL = 'https://solid.nodezero.social'
process.env.JSS_ISSUER_URL = 'https://staging.nodezero.social'
process.env.JSS_INTERNAL_API_KEY = 'test-internal-key'
process.env.JSS_SESSION_SIGNING_KEY = 'directory-route-test-session-key-32b!'
const tempDirectory = mkdtempSync(join(tmpdir(), 'nz-jss-index-community-directory-'))
process.env.JSS_COMMUNITY_DIRECTORY_STORE_PATH = join(tempDirectory, 'community-directory.json')

let createRequestHandler: (overrides?: Record<string, unknown>) =>
  (req: IncomingMessage, res: ServerResponse) => void

before(async () => {
  const mod = await import('./index.js')
  createRequestHandler = mod.createRequestHandler
})

after(() => {
  rmSync(tempDirectory, { recursive: true, force: true })
})

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
  overrides: Record<string, unknown> = {}
): Promise<T> {
  const server = createServer(createRequestHandler(overrides))
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
    assert.ok(response.headers.get('etag'))
  })
})

void test('/v1/community-directory/index honors cache validators', async () => {
  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/v1/community-directory/index?limit=1`)
    const etag = first.headers.get('etag')
    assert.ok(etag)
    const cached = await fetch(`${baseUrl}/v1/community-directory/index?limit=1`, {
      headers: { 'if-none-match': etag },
    })
    assert.equal(cached.status, 304)
    assert.equal(cached.headers.get('etag'), etag)
  })
})

void test('/v1/community-directory/refresh requires a valid NodeZero session', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/community-directory/refresh`, {
      method: 'POST',
    })

    const payload = (await response.json()) as { code?: string }
    assert.equal(response.status, 401)
    assert.equal(payload.code, 'session_invalid')
  })
})

void test('/v1/community-directory/refresh derives the owner from the session', async () => {
  const ownerWebId = 'https://solid.nodezero.social/alice/profile/card#me'
  const session = new SessionTokenManager({
    signingKey: process.env.JSS_SESSION_SIGNING_KEY,
    issuer: 'https://staging.nodezero.social',
  }).issue({
    webId: ownerWebId,
    podUrl: 'https://solid.nodezero.social/alice/',
  })
  let refreshedSubject = ''
  const record: CommunityDirectoryRecord = {
    webId: ownerWebId,
    podUrl: 'https://solid.nodezero.social/alice/',
    issuer: 'https://solid.nodezero.social',
    listed: true,
    updatedAt: '2026-08-01T12:00:00.000Z',
  }
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/community-directory/refresh`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    const payload = (await response.json()) as {
      listed?: boolean
      record?: CommunityDirectoryRecord
    }
    assert.equal(response.status, 200)
    assert.equal(payload.listed, true)
    assert.equal(payload.record?.webId, ownerWebId)
    assert.equal(refreshedSubject, ownerWebId)
  }, {
    refreshCommunityDirectoryProjection: (
      claims: { sub: string }
    ): Promise<CommunityDirectoryRecord> => {
      refreshedSubject = claims.sub
      return Promise.resolve(record)
    },
  })
})

void test('/v1/community-directory/opt-in is retired even with the legacy internal key', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/community-directory/opt-in`, {
      method: 'POST',
      headers: { 'x-nz-internal-key': 'test-internal-key' },
    })
    const payload = (await response.json()) as { code?: string }
    assert.equal(response.status, 410)
    assert.equal(payload.code, 'directory_mutation_retired')
  })
})
