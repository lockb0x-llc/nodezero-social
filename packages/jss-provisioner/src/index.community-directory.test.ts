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
import type { PublicPeerProfileResult } from './publicPeerProfile.js'
import { hashCohortIdentity } from './milestoneQControls.js'

process.env.JSS_SOLID_CSS_BASE_URL = 'https://solid.nodezero.social'
process.env.JSS_ISSUER_URL = 'https://staging.nodezero.social'
process.env.JSS_INTERNAL_API_KEY = 'test-internal-key'
process.env.JSS_SESSION_SIGNING_KEY = 'directory-route-test-session-key-32b!'
process.env.JSS_Q_DIRECTORY_ENABLED = 'true'
process.env.JSS_Q_PEER_PROFILE_ENABLED = 'true'
process.env.JSS_Q_COHORT_KEY = 'directory-route-test-cohort-key'
process.env.JSS_Q_COHORT_HASHES = hashCohortIdentity(
  'https://solid.nodezero.social/alice/profile/card#me',
  process.env.JSS_Q_COHORT_KEY
)
const tempDirectory = mkdtempSync(join(tmpdir(), 'nz-jss-index-community-directory-'))
process.env.JSS_COMMUNITY_DIRECTORY_STORE_PATH = join(tempDirectory, 'community-directory.json')
const directorySession = new SessionTokenManager({
  signingKey: process.env.JSS_SESSION_SIGNING_KEY,
  issuer: 'https://staging.nodezero.social',
}).issue({
  webId: 'https://solid.nodezero.social/alice/profile/card#me',
  podUrl: 'https://solid.nodezero.social/alice/',
})

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
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${directorySession.accessToken}`,
      },
    })

    const payload = (await response.json()) as { version?: number; members?: unknown[] }
    assert.equal(response.status, 200)
    assert.equal(payload.version, 1)
    assert.deepEqual(payload.members, [])
    assert.ok(response.headers.get('etag'))
    assert.equal(
      response.headers.get('cache-control'),
      'private, no-cache, must-revalidate'
    )
  })
})

void test('/v1/community-directory/index honors cache validators', async () => {
  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/v1/community-directory/index?limit=1`, {
      headers: { authorization: `Bearer ${directorySession.accessToken}` },
    })
    const etag = first.headers.get('etag')
    assert.ok(etag)
    const cached = await fetch(`${baseUrl}/v1/community-directory/index?limit=1`, {
      headers: {
        'if-none-match': etag,
        authorization: `Bearer ${directorySession.accessToken}`,
      },
    })
    assert.equal(cached.status, 304)
    assert.equal(cached.headers.get('etag'), etag)
    assert.equal(
      cached.headers.get('cache-control'),
      'private, no-cache, must-revalidate'
    )
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

void test('/v1/public-profile/read requires a valid NodeZero session', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/public-profile/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ webId: 'https://peer.example/profile/card#me' }),
    })
    assert.equal(response.status, 401)
    assert.equal(((await response.json()) as { code?: string }).code, 'session_invalid')
  })
})

void test('/v1/public-profile/read delegates peer WebID to credential-free service', async () => {
  const ownerWebId = 'https://solid.nodezero.social/alice/profile/card#me'
  const peerWebId = 'https://peer.example/profile/card#me'
  const session = new SessionTokenManager({
    signingKey: process.env.JSS_SESSION_SIGNING_KEY,
    issuer: 'https://staging.nodezero.social',
  }).issue({
    webId: ownerWebId,
    podUrl: 'https://solid.nodezero.social/alice/',
  })
  let requestedWebId = ''
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/public-profile/read`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ webId: peerWebId }),
    })
    const payload = (await response.json()) as PublicPeerProfileResult
    assert.equal(response.status, 200)
    assert.equal(payload.webId, peerWebId)
    assert.equal(payload.profile?.displayName, 'Peer')
    assert.equal(payload.authenticated, false)
    assert.equal(requestedWebId, peerWebId)
  }, {
    readPublicPeerProfile: (webId: string): Promise<PublicPeerProfileResult> => {
      requestedWebId = webId
      return Promise.resolve({
        webId,
        profile: {
          displayName: 'Peer',
          bio: 'Public profile',
          interests: ['solid'],
          isNsfw: false,
        },
        authenticated: false,
      })
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
