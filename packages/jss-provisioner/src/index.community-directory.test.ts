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
process.env.JSS_COMMUNITY_DIRECTORY_AVATAR_MAX_CONCURRENCY = '1'
const tempDirectory = mkdtempSync(join(tmpdir(), 'nz-jss-index-community-directory-'))
process.env.JSS_COMMUNITY_DIRECTORY_STORE_PATH = join(tempDirectory, 'community-directory.json')
const directorySession = new SessionTokenManager({
  signingKey: process.env.JSS_SESSION_SIGNING_KEY,
  issuer: 'https://staging.nodezero.social',
}).issue({
  webId: 'https://solid.nodezero.social/alice/profile/card#me',
  podUrl: 'https://solid.nodezero.social/alice/',
})
const nonCohortSession = new SessionTokenManager({
  signingKey: process.env.JSS_SESSION_SIGNING_KEY,
  issuer: 'https://staging.nodezero.social',
}).issue({
  webId: 'https://solid.nodezero.social/bob/profile/card#me',
  podUrl: 'https://solid.nodezero.social/bob/',
})

let createRequestHandler: (
  overrides?: Record<string, unknown>
) => (req: IncomingMessage, res: ServerResponse) => void

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
    assert.equal(response.headers.get('cache-control'), 'private, no-cache, must-revalidate')
  })
})

void test('/v1/community-directory/index sanitizes persistence reload failures', async () => {
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/community-directory/index`, {
        headers: { authorization: `Bearer ${directorySession.accessToken}` },
      })
      assert.equal(response.status, 503)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.deepEqual(await response.json(), {
        error: 'Community directory index is temporarily unavailable.',
        code: 'directory_index_unavailable',
      })
    },
    {
      reloadCommunityDirectory: () => Promise.reject(new Error('table secret must not escape')),
    }
  )
})

void test('/v1/milestone-q/features requires a valid NodeZero session', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/milestone-q/features`)
    assert.equal(response.status, 401)
    assert.equal(((await response.json()) as { code?: string }).code, 'session_invalid')
  })
})

void test('/v1/milestone-q/features returns session-bound cohort availability', async () => {
  const bobSession = new SessionTokenManager({
    signingKey: process.env.JSS_SESSION_SIGNING_KEY,
    issuer: 'https://staging.nodezero.social',
  }).issue({
    webId: 'https://solid.nodezero.social/bob/profile/card#me',
    podUrl: 'https://solid.nodezero.social/bob/',
  })
  await withServer(async (baseUrl) => {
    const eligible = await fetch(`${baseUrl}/v1/milestone-q/features`, {
      headers: { authorization: `Bearer ${directorySession.accessToken}` },
    })
    assert.equal(eligible.status, 200)
    assert.equal(eligible.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(await eligible.json(), {
      version: 1,
      features: {
        directory: true,
        peerProfile: true,
        relationship: false,
        transport: false,
      },
    })

    const ineligible = await fetch(`${baseUrl}/v1/milestone-q/features`, {
      headers: { authorization: `Bearer ${bobSession.accessToken}` },
    })
    assert.equal(ineligible.status, 200)
    assert.deepEqual(await ineligible.json(), {
      version: 1,
      features: {
        directory: false,
        peerProfile: false,
        relationship: false,
        transport: false,
      },
    })
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
    assert.equal(cached.headers.get('cache-control'), 'private, no-cache, must-revalidate')
  })
})

void test('/v1/community-directory/index denies an authenticated non-cohort viewer', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/community-directory/index`, {
      headers: { authorization: `Bearer ${nonCohortSession.accessToken}` },
    })
    assert.equal(response.status, 404)
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
  await withServer(
    async (baseUrl) => {
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
    },
    {
      refreshCommunityDirectoryProjection: (claims: {
        sub: string
      }): Promise<CommunityDirectoryRecord> => {
        refreshedSubject = claims.sub
        return Promise.resolve(record)
      },
    }
  )
})

void test('/v1/community-directory/refresh suppresses listing for a non-cohort owner', async () => {
  let allowListing: boolean | undefined
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/community-directory/refresh`, {
        method: 'POST',
        headers: { authorization: `Bearer ${nonCohortSession.accessToken}` },
      })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), {
        status: 'ok',
        listed: false,
        available: false,
        record: {
          webId: nonCohortSession.webId,
          podUrl: nonCohortSession.podUrl,
          issuer: 'https://solid.nodezero.social',
          listed: false,
          updatedAt: '2026-08-01T12:00:00.000Z',
        },
      })
      assert.equal(allowListing, false)
    },
    {
      refreshCommunityDirectoryProjection: (
        claims: { sub: string; pod: string },
        options: { allowListing?: boolean }
      ): Promise<CommunityDirectoryRecord> => {
        allowListing = options.allowListing
        return Promise.resolve({
          webId: claims.sub,
          podUrl: claims.pod,
          issuer: 'https://solid.nodezero.social',
          listed: false,
          updatedAt: '2026-08-01T12:00:00.000Z',
        })
      },
    }
  )
})

void test('/v1/community-directory/suppress remains available after cohort withdrawal', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/community-directory/suppress`, {
      method: 'POST',
      headers: { authorization: `Bearer ${nonCohortSession.accessToken}` },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok', listed: false })
  })
})

void test('/v1/community-directory/suppress is independent from refresh throttling', async () => {
  const rateLimitedSession = new SessionTokenManager({
    signingKey: process.env.JSS_SESSION_SIGNING_KEY,
    issuer: 'https://staging.nodezero.social',
  }).issue({
    webId: 'https://solid.nodezero.social/rate-limited/profile/card#me',
    podUrl: 'https://solid.nodezero.social/rate-limited/',
  })
  await withServer(
    async (baseUrl) => {
      for (let request = 0; request < 12; request += 1) {
        const refresh = await fetch(`${baseUrl}/v1/community-directory/refresh`, {
          method: 'POST',
          headers: { authorization: `Bearer ${rateLimitedSession.accessToken}` },
        })
        assert.equal(refresh.status, 200)
      }
      const throttledRefresh = await fetch(`${baseUrl}/v1/community-directory/refresh`, {
        method: 'POST',
        headers: { authorization: `Bearer ${rateLimitedSession.accessToken}` },
      })
      assert.equal(throttledRefresh.status, 429)

      const suppress = await fetch(`${baseUrl}/v1/community-directory/suppress`, {
        method: 'POST',
        headers: { authorization: `Bearer ${rateLimitedSession.accessToken}` },
      })
      assert.equal(suppress.status, 200)
      assert.deepEqual(await suppress.json(), { status: 'ok', listed: false })
    },
    {
      refreshCommunityDirectoryProjection: (claims: {
        sub: string
        pod: string
      }): Promise<CommunityDirectoryRecord> =>
        Promise.resolve({
          webId: claims.sub,
          podUrl: claims.pod,
          issuer: 'https://solid.nodezero.social',
          listed: false,
          updatedAt: '2026-08-01T12:00:00.000Z',
        }),
    }
  )
})

void test('/v1/community-directory/avatar proxies only the stored listed avatar', async () => {
  const avatarWebId = directorySession.webId
  let requestedWebId = ''
  let requestedAvatarUrl = ''
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/community-directory/avatar`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${directorySession.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ webId: avatarWebId }),
      })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'image/png')
      assert.equal(response.headers.get('cache-control'), 'private, max-age=300')
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([1, 2, 3]))
      assert.equal(requestedWebId, avatarWebId)
      assert.equal(requestedAvatarUrl, 'https://cdn.example/avatar.png')
    },
    {
      readDirectoryRecord: (webId: string): Promise<CommunityDirectoryRecord> => {
        requestedWebId = webId
        return Promise.resolve({
          webId,
          podUrl: 'https://solid.nodezero.social/avatar/',
          issuer: 'https://solid.nodezero.social',
          listed: true,
          updatedAt: '2026-08-05T12:00:00.000Z',
          avatarUrl: 'https://cdn.example/avatar.png',
          manifestExpiresAt: '2099-08-12T12:00:00.000Z',
        })
      },
      fetchDirectoryAvatar: (url: string, options: { allowedContentTypes?: readonly string[] }) => {
        requestedAvatarUrl = url
        assert.deepEqual(options.allowedContentTypes, [
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/gif',
        ])
        return Promise.resolve({
          finalUrl: url,
          status: 200,
          contentType: 'image/png',
          body: Buffer.from([1, 2, 3]),
        })
      },
    }
  )
})

void test('/v1/community-directory/avatar requires an authenticated eligible viewer', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/community-directory/avatar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ webId: 'x' }),
    })
    assert.equal(response.status, 401)
  })
})

void test('/v1/community-directory/avatar denies an authenticated non-cohort viewer', async () => {
  let readCalled = false
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/community-directory/avatar`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${nonCohortSession.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ webId: directorySession.webId }),
      })
      assert.equal(response.status, 404)
      assert.equal(readCalled, false)
    },
    {
      readDirectoryRecord: () => {
        readCalled = true
        return Promise.resolve(null)
      },
    }
  )
})

void test('/v1/community-directory/avatar rejects a stored owner outside the current cohort', async () => {
  let fetchCalled = false
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/community-directory/avatar`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${directorySession.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ webId: nonCohortSession.webId }),
      })
      assert.equal(response.status, 404)
      assert.equal(fetchCalled, false)
    },
    {
      readDirectoryRecord: (): Promise<CommunityDirectoryRecord> =>
        Promise.resolve({
          webId: nonCohortSession.webId,
          podUrl: nonCohortSession.podUrl,
          issuer: 'https://solid.nodezero.social',
          listed: true,
          updatedAt: '2026-08-05T12:00:00.000Z',
          avatarUrl: 'https://cdn.example/avatar.png',
          manifestExpiresAt: '2099-08-12T12:00:00.000Z',
        }),
      fetchDirectoryAvatar: () => {
        fetchCalled = true
        throw new Error('must not fetch')
      },
    }
  )
})

void test('/v1/community-directory/avatar rejects expired records before fetching bytes', async () => {
  let fetchCalled = false
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/community-directory/avatar`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${directorySession.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ webId: 'https://solid.nodezero.social/expired/profile/card#me' }),
      })
      assert.equal(response.status, 404)
      assert.equal(fetchCalled, false)
    },
    {
      readDirectoryRecord: (webId: string): Promise<CommunityDirectoryRecord> =>
        Promise.resolve({
          webId,
          podUrl: 'https://solid.nodezero.social/expired/',
          issuer: 'https://solid.nodezero.social',
          listed: true,
          updatedAt: '2026-08-01T00:00:00.000Z',
          avatarUrl: 'https://cdn.example/avatar.png',
          manifestExpiresAt: '2026-08-02T00:00:00.000Z',
        }),
      fetchDirectoryAvatar: () => {
        fetchCalled = true
        throw new Error('must not fetch')
      },
    }
  )
})

void test('/v1/community-directory/avatar enforces concurrency before outbound fetches', async () => {
  let started = 0
  let releaseFetches!: () => void
  let capacityReached!: () => void
  const release = new Promise<void>((resolve) => {
    releaseFetches = resolve
  })
  const reachedCapacity = new Promise<void>((resolve) => {
    capacityReached = resolve
  })
  await withServer(
    async (baseUrl) => {
      const request = (): Promise<Response> =>
        fetch(`${baseUrl}/v1/community-directory/avatar`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${directorySession.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ webId: directorySession.webId }),
        })
      const active = [request()]
      await reachedCapacity
      const limited = await request()
      assert.equal(limited.status, 429)
      assert.equal(((await limited.json()) as { code?: string }).code, 'avatar_concurrency_limited')
      releaseFetches()
      const completed = await Promise.all(active)
      assert.equal(
        completed.every((response) => response.status === 200),
        true
      )
    },
    {
      readDirectoryRecord: (webId: string): Promise<CommunityDirectoryRecord> =>
        Promise.resolve({
          webId,
          podUrl: 'https://solid.nodezero.social/avatar/',
          issuer: 'https://solid.nodezero.social',
          listed: true,
          updatedAt: '2026-08-05T12:00:00.000Z',
          avatarUrl: 'https://cdn.example/avatar.png',
          manifestExpiresAt: '2099-08-12T12:00:00.000Z',
        }),
      fetchDirectoryAvatar: async (url: string) => {
        started += 1
        capacityReached()
        await release
        return {
          finalUrl: url,
          status: 200,
          contentType: 'image/png',
          body: Buffer.from([1]),
        }
      },
    }
  )
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
  await withServer(
    async (baseUrl) => {
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
    },
    {
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
    }
  )
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
