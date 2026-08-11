import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { SessionClaims } from './sessionTokens.js'
import { CommunityDirectoryStore } from './communityDirectory.js'
import {
  CommunityDirectoryRefreshError,
  refreshCommunityDirectoryProjection,
} from './communityDirectoryRefresh.js'

const alice = 'https://solid.example/alice/profile/card#me'
const podRoot = 'https://solid.example/alice/'
const claims: SessionClaims = {
  sub: alice,
  pod: podRoot,
  spk: null,
  aud: 'nz-session-v1',
  iss: 'https://api.example',
  iat: 1,
  exp: 2,
  jti: 'test',
}
const now = new Date('2026-08-02T00:00:00.000Z')
const testDirectory = mkdtempSync(join(tmpdir(), 'nz-directory-refresh-'))
let storeCounter = 0

process.on('exit', () => {
  rmSync(testDirectory, { recursive: true, force: true })
})

function createTestStore(): CommunityDirectoryStore {
  storeCounter += 1
  return new CommunityDirectoryStore({
    persistenceFilePath: join(testDirectory, `directory-${storeCounter}.json`),
  })
}

function response(body: string, url: string, etag?: string): Response {
  const result = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/turtle',
      ...(etag ? { etag } : {}),
    },
  })
  Object.defineProperty(result, 'url', { value: url })
  return result
}

function baseOptions(
  fetchImpl: typeof globalThis.fetch,
  store = createTestStore()
): {
  store: CommunityDirectoryStore
  options: Parameters<typeof refreshCommunityDirectoryProjection>[1]
} {
  globalThis.fetch = fetchImpl
  return {
    store,
    options: {
      cssBaseUrl: 'https://solid.example',
      credentialStore: {
        findByWebId: () =>
          Promise.resolve({
            webId: alice,
            podUrl: podRoot,
            stellarPublicKey: null,
            clientCredentialsId: 'client-id',
            clientCredentialsSecret: 'client-secret',
            userLockboxContractId: null,
            lockboxFactoryContractId: null,
            proofRootHex: null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          }),
      },
      directoryStore: store,
      mintToken: () =>
        Promise.resolve({
          accessToken: 'solid-token',
          expiresAtMs: now.getTime() + 60_000,
          proof: (): string => 'dpop-proof',
        }),
      now,
    },
  }
}

void test('refreshes an owner projection from consent and an unexpired manifest', async () => {
  const consentUrl = `${podRoot}social/consent/discovery`
  const manifestUrl = `${podRoot}public/discovery/manifest`
  const publicTypeIndexUrl = `${podRoot}settings/publicTypeIndex`
  const profileUrl = alice.split('#')[0] ?? ''
  const calls: string[] = []
  const originalFetch = globalThis.fetch
  const { store, options } = baseOptions((input, init) => {
    const url = String(input)
    calls.push(url)
    assert.equal(new Headers(init?.headers).get('authorization'), 'DPoP solid-token')
    if (url === consentUrl)
      return Promise.resolve(
        response(
          `
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:publicationRevision 4 ;
        nz:publicationUpdatedAt "2026-08-01T12:00:00.000Z" ;
        nz:ownerWebId <${alice}> ; nz:publicListing true ; nz:publicIndexing true ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-01T12:00:00.000Z" .
    `,
          consentUrl
        )
      )
    if (url === manifestUrl) return Promise.resolve(
      response(
        `
      @prefix nz: <https://nodezero.social/ns#> .
      <${manifestUrl}#manifest> a nz:DiscoveryManifest ; nz:version 1 ;
        nz:publicationRevision 4 ;
        nz:webId <${alice}> ; nz:publishedAt "2026-08-01T12:00:00.000Z" ;
        nz:expiresAt "2026-08-08T12:00:00.000Z" ; nz:displayName "Alice" ;
        <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${publicTypeIndexUrl}> ;
        nz:publicInterest "solid" .
    `,
        manifestUrl,
        '"manifest-v1"'
      )
    )
    if (url === profileUrl) {
      return Promise.resolve(
        response(
          `<${alice}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${publicTypeIndexUrl}> .`,
          profileUrl
        )
      )
    }
    return Promise.resolve(
      response(
        `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix nz: <https://nodezero.social/ns#> .
      <${publicTypeIndexUrl}> a solid:TypeIndex, solid:ListedDocument .
      <${publicTypeIndexUrl}#nodezero-discovery-manifest> a solid:TypeRegistration ;
        solid:forClass <https://nodezero.social/ns#DiscoveryManifest> ;
        solid:instance <${manifestUrl}> ;
        nz:publicationRevision 4 .
    `,
        publicTypeIndexUrl
      )
    )
  })
  try {
    const projected = await refreshCommunityDirectoryProjection(claims, options)
    assert.equal(projected.listed, true)
    assert.equal(projected.displayName, 'Alice')
    assert.equal(projected.sourceRevision, '"manifest-v1"')
    assert.equal(store.buildPublicPage({ now }).members.length, 1)
    assert.deepEqual(calls, [consentUrl, manifestUrl, profileUrl, publicTypeIndexUrl])
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('opt-out removes projection without reading the public manifest', async () => {
  const consentUrl = `${podRoot}social/consent/discovery`
  const calls: string[] = []
  const originalFetch = globalThis.fetch
  const store = createTestStore()
  store.refreshProjection({
    webId: alice,
    podUrl: podRoot,
    issuer: 'https://solid.example',
    publicListing: true,
    publicIndexing: true,
    publicationUpdatedAt: '2026-08-01T00:00:00.000Z',
    manifestUrl: `${podRoot}public/discovery/manifest`,
    manifest: {
      publishedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-08T00:00:00.000Z',
      displayName: 'Alice',
    },
    now,
  })
  const { options } = baseOptions((input) => {
    const url = String(input)
    calls.push(url)
    return Promise.resolve(
      response(
        `
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:ownerWebId <${alice}> ; nz:publicListing false ; nz:publicIndexing false ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-02T00:00:00.000Z" .
    `,
        consentUrl
      )
    )
  }, store)
  try {
    const projected = await refreshCommunityDirectoryProjection(claims, options)
    assert.equal(projected.listed, false)
    assert.equal(projected.displayName, undefined)
    assert.deepEqual(calls, [consentUrl])
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('stale suppression cannot tombstone a newer publication generation', async () => {
  const consentUrl = `${podRoot}social/consent/discovery`
  const originalFetch = globalThis.fetch
  const store = createTestStore()
  store.refreshProjection({
    webId: alice,
    podUrl: podRoot,
    issuer: 'https://solid.example',
    publicListing: true,
    publicIndexing: false,
    publicationRevision: 5,
    publicationUpdatedAt: '2026-08-02T00:00:00.000Z',
    manifestUrl: `${podRoot}public/discovery/manifest`,
    manifest: {
      publicationRevision: 5,
      publishedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-08T00:00:00.000Z',
      displayName: 'Alice',
    },
    now,
  })
  const { options } = baseOptions(() =>
    Promise.resolve(
      response(
        `
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:publicationRevision 5 ;
        nz:publicationUpdatedAt "2026-08-02T00:00:00.000Z" ;
        nz:ownerWebId <${alice}> ; nz:publicListing true ; nz:publicIndexing false ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-02T00:00:00.000Z" .
    `,
        consentUrl
      )
    ), store)
  try {
    await assert.rejects(
      refreshCommunityDirectoryProjection(claims, {
        ...options,
        allowListing: false,
        expectedPublicationRevision: 4,
      }),
      (error: unknown) =>
        error instanceof CommunityDirectoryRefreshError && error.code === 'publication_changed'
    )
    assert.equal(store.buildPublicPage({ now }).members.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('cohort-disabled refresh suppresses the authoritative current generation', async () => {
  const consentUrl = `${podRoot}social/consent/discovery`
  const originalFetch = globalThis.fetch
  const store = createTestStore()
  const { options } = baseOptions(() =>
    Promise.resolve(
      response(
        `
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:publicationRevision 5 ; nz:publicationUpdatedAt "2026-08-02T00:00:00.000Z" ;
        nz:ownerWebId <${alice}> ; nz:publicListing true ; nz:publicIndexing false ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-02T00:00:00.000Z" .
    `,
        consentUrl
      )
    ), store)
  try {
    const record = await refreshCommunityDirectoryProjection(claims, {
      ...options,
      allowListing: false,
    })
    assert.equal(record.listed, false)
    assert.equal(record.suppressionRevision, 5)
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('suppression reconciles a publication committed during persistence', async () => {
  const consentUrl = `${podRoot}social/consent/discovery`
  const manifestUrl = `${podRoot}public/discovery/manifest`
  const publicTypeIndexUrl = `${podRoot}settings/publicTypeIndex`
  const profileUrl = alice.split('#')[0] ?? ''
  const originalFetch = globalThis.fetch
  const store = createTestStore()
  let publicationRevision = 4
  const { options } = baseOptions((input) => {
    const url = String(input)
    if (url === consentUrl) {
      const listing = publicationRevision === 5
      return Promise.resolve(
        response(
          `
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:publicationRevision ${publicationRevision} ;
        nz:publicationUpdatedAt "2026-08-02T00:00:00.000Z" ;
        nz:ownerWebId <${alice}> ; nz:publicListing ${String(listing)} ;
        nz:publicIndexing false ; nz:nearbyPresence false ;
        nz:inboundContactRequests false ; nz:localBroadcasts false ;
        nz:updatedAt "2026-08-02T00:00:00.000Z" .
    `,
          consentUrl
        )
      )
    }
    if (url === manifestUrl) {
      return Promise.resolve(
        response(
          `
      @prefix nz: <https://nodezero.social/ns#> .
      <${manifestUrl}#manifest> a nz:DiscoveryManifest ; nz:version 1 ;
        nz:publicationRevision 5 ; nz:webId <${alice}> ;
        nz:publishedAt "2026-08-02T00:00:00.000Z" ;
        nz:expiresAt "2026-08-08T00:00:00.000Z" ;
        <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${publicTypeIndexUrl}> .
    `,
          manifestUrl
        )
      )
    }
    if (url === profileUrl) {
      return Promise.resolve(
        response(
          `<${alice}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${publicTypeIndexUrl}> .`,
          profileUrl
        )
      )
    }
    return Promise.resolve(
      response(
        `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix nz: <https://nodezero.social/ns#> .
      <${publicTypeIndexUrl}> a solid:TypeIndex, solid:ListedDocument .
      <${publicTypeIndexUrl}#nodezero-discovery-manifest> a solid:TypeRegistration ;
        solid:forClass <https://nodezero.social/ns#DiscoveryManifest> ;
        solid:instance <${manifestUrl}> ; nz:publicationRevision 5 .
    `,
        publicTypeIndexUrl
      )
    )
  }, store)
  const originalRefresh = store.refreshProjection.bind(store)
  options.directoryStore = {
    refreshProjection: (input): ReturnType<CommunityDirectoryStore['refreshProjection']> => {
      const record = originalRefresh(input)
      if (input.suppressed) publicationRevision = 5
      return record
    },
    reloadRecord: store.reloadRecord.bind(store),
    flush: store.flush.bind(store),
    getByWebId: store.getByWebId.bind(store),
  }
  try {
    await assert.rejects(
      refreshCommunityDirectoryProjection(claims, {
        ...options,
        allowListing: false,
        expectedPublicationRevision: 4,
      }),
      (error: unknown) =>
        error instanceof CommunityDirectoryRefreshError && error.code === 'publication_changed'
    )
    assert.equal(store.buildPublicPage({ now }).members.length, 1)
    assert.equal(store.getByWebId(alice)?.suppressedAt, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('rejects a session Pod outside the configured CSS origin', async () => {
  const store = createTestStore()
  await assert.rejects(
    refreshCommunityDirectoryProjection(
      { ...claims, pod: 'https://other.example/alice/' },
      {
        cssBaseUrl: 'https://solid.example',
        credentialStore: { findByWebId: () => Promise.resolve(null) },
        directoryStore: store,
      }
    ),
    (error: unknown) =>
      error instanceof CommunityDirectoryRefreshError && error.code === 'pod_origin_mismatch'
  )
})

void test('token mint failure invalidates the NodeZero session', async () => {
  const store = createTestStore()
  await assert.rejects(
    refreshCommunityDirectoryProjection(claims, {
      ...baseOptions(() => Promise.reject(new Error('must not read')), store).options,
      mintToken: () => Promise.reject(new Error('invalid client credentials')),
    }),
    (error: unknown) =>
      error instanceof CommunityDirectoryRefreshError && error.code === 'session_invalid'
  )
  assert.equal(store.getByWebId(alice), null)
})

void test('Pod 401 invalidates the NodeZero session before projection mutation', async () => {
  const store = createTestStore()
  const originalFetch = globalThis.fetch
  const { options } = baseOptions(() => Promise.resolve(new Response('', { status: 401 })), store)
  try {
    await assert.rejects(
      refreshCommunityDirectoryProjection(claims, options),
      (error: unknown) =>
        error instanceof CommunityDirectoryRefreshError && error.code === 'session_invalid'
    )
    assert.equal(store.getByWebId(alice), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('manifest 401 propagates session invalidation without mutating projection', async () => {
  const consentUrl = `${podRoot}social/consent/discovery`
  const originalFetch = globalThis.fetch
  const store = createTestStore()
  let projectionMutated = false
  const { options } = baseOptions((input) => {
    const url = String(input)
    if (url === consentUrl) {
      return Promise.resolve(
        response(
          `
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:publicationRevision 5 ; nz:publicationUpdatedAt "2026-08-02T00:00:00.000Z" ;
        nz:ownerWebId <${alice}> ; nz:publicListing true ; nz:publicIndexing false ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-02T00:00:00.000Z" .
    `,
          consentUrl
        )
      )
    }
    return Promise.resolve(new Response('', { status: 401 }))
  }, store)
  options.directoryStore = {
    reloadRecord: store.reloadRecord.bind(store),
    flush: store.flush.bind(store),
    getByWebId: store.getByWebId.bind(store),
    refreshProjection: (input): ReturnType<CommunityDirectoryStore['refreshProjection']> => {
      projectionMutated = true
      return store.refreshProjection(input)
    },
  }
  try {
    await assert.rejects(
      refreshCommunityDirectoryProjection(claims, options),
      (error: unknown) =>
        error instanceof CommunityDirectoryRefreshError && error.code === 'session_invalid'
    )
    assert.equal(projectionMutated, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('invalid manifest data clears a previously public projection', async () => {
  const consentUrl = `${podRoot}social/consent/discovery`
  const manifestUrl = `${podRoot}public/discovery/manifest`
  const originalFetch = globalThis.fetch
  const store = createTestStore()
  store.refreshProjection({
    webId: alice,
    podUrl: podRoot,
    issuer: 'https://solid.example',
    publicListing: true,
    publicIndexing: true,
    publicationUpdatedAt: '2026-08-01T00:00:00.000Z',
    manifestUrl,
    manifest: {
      publishedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-08T00:00:00.000Z',
      displayName: 'Alice',
    },
    now,
  })
  const { options } = baseOptions((input) => {
    const url = String(input)
    if (url === consentUrl)
      return Promise.resolve(
        response(
          `
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:ownerWebId <${alice}> ; nz:publicListing true ; nz:publicIndexing true ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-02T00:00:00.000Z" .
    `,
          consentUrl
        )
      )
    return Promise.resolve(
      response(
        `
      @prefix nz: <https://nodezero.social/ns#> .
      <${manifestUrl}#manifest> a nz:DiscoveryManifest ; nz:version 1 ;
        nz:webId <https://mallory.example/profile/card#me> ;
        nz:publishedAt "2026-08-01T00:00:00.000Z" ;
        nz:expiresAt "2026-08-08T00:00:00.000Z" .
    `,
        manifestUrl
      )
    )
  }, store)
  try {
    const projected = await refreshCommunityDirectoryProjection(claims, options)
    assert.equal(projected.listed, false)
    assert.equal(projected.displayName, undefined)
    assert.deepEqual(store.buildPublicPage({ now }).members, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('does not project a manifest authorized by a different consent revision', async () => {
  const consentUrl = `${podRoot}social/consent/discovery`
  const manifestUrl = `${podRoot}public/discovery/manifest`
  const originalFetch = globalThis.fetch
  const { options } = baseOptions((input) => {
    const url = String(input)
    if (url === consentUrl)
      return Promise.resolve(
        response(
          `
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ; nz:revision 5 ;
        nz:publicationRevision 5 ;
        nz:publicationUpdatedAt "2026-08-02T00:00:00.000Z" ;
        nz:ownerWebId <${alice}> ; nz:publicListing true ; nz:publicIndexing false ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-02T00:00:00.000Z" .
    `,
          consentUrl
        )
      )
    return Promise.resolve(
      response(
        `
      @prefix nz: <https://nodezero.social/ns#> .
      <${manifestUrl}#manifest> a nz:DiscoveryManifest ; nz:version 1 ;
        nz:webId <${alice}> ; nz:publicationRevision 4 ;
        nz:publishedAt "2026-08-01T00:00:00.000Z" ;
        nz:expiresAt "2026-08-08T00:00:00.000Z" .
    `,
        manifestUrl,
        '"manifest-4"'
      )
    )
  })
  try {
    const projected = await refreshCommunityDirectoryProjection(claims, options)
    assert.equal(projected.listed, false)
    assert.equal(projected.sourceRevision, '"manifest-4"')
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('does not project generationless legacy publication artifacts', async () => {
  const consentUrl = `${podRoot}social/consent/discovery`
  const manifestUrl = `${podRoot}public/discovery/manifest`
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  const { store, options } = baseOptions((input) => {
    const url = String(input)
    calls.push(url)
    if (url === consentUrl) {
      return Promise.resolve(
        response(
          `
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:ownerWebId <${alice}> ; nz:publicListing true ; nz:publicIndexing true ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-01T12:00:00.000Z" .
    `,
          consentUrl
        )
      )
    }
    throw new Error(`Legacy projection must not read ${url}.`)
  })
  try {
    const projected = await refreshCommunityDirectoryProjection(claims, options)
    assert.equal(projected.listed, false)
    assert.equal(store.buildPublicPage({ now }).members.length, 0)
    assert.deepEqual(calls, [consentUrl])
    assert.equal(projected.manifestUrl, manifestUrl)
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('missing WebID Type Index authority clears a committed listing', async () => {
  const consentUrl = `${podRoot}social/consent/discovery`
  const manifestUrl = `${podRoot}public/discovery/manifest`
  const publicTypeIndexUrl = `${podRoot}settings/publicTypeIndex`
  const profileUrl = alice.split('#')[0] ?? ''
  const originalFetch = globalThis.fetch
  const store = createTestStore()
  store.refreshProjection({
    webId: alice,
    podUrl: podRoot,
    issuer: 'https://solid.example',
    publicListing: true,
    publicIndexing: false,
    publicationRevision: 5,
    publicationUpdatedAt: now.toISOString(),
    manifestUrl,
    manifest: {
      publicationRevision: 5,
      publishedAt: now.toISOString(),
      expiresAt: '2026-08-08T00:00:00.000Z',
    },
    now,
  })
  const { options } = baseOptions((input) => {
    const url = String(input)
    if (url === consentUrl) {
      return Promise.resolve(
        response(
          `
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:publicationRevision 5 ; nz:publicationUpdatedAt "2026-08-02T00:00:00.000Z" ;
        nz:ownerWebId <${alice}> ; nz:publicListing true ; nz:publicIndexing false ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-02T00:00:00.000Z" .
    `,
          consentUrl
        )
      )
    }
    if (url === manifestUrl) {
      return Promise.resolve(
        response(
          `
      @prefix nz: <https://nodezero.social/ns#> .
      <${manifestUrl}#manifest> a nz:DiscoveryManifest ; nz:version 1 ;
        nz:publicationRevision 5 ; nz:webId <${alice}> ;
        nz:publishedAt "2026-08-02T00:00:00.000Z" ;
        nz:expiresAt "2026-08-08T00:00:00.000Z" ;
        <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${publicTypeIndexUrl}> .
    `,
          manifestUrl
        )
      )
    }
    if (url === profileUrl) {
      const missing = new Response('', { status: 404 })
      Object.defineProperty(missing, 'url', { value: profileUrl })
      return Promise.resolve(missing)
    }
    throw new Error(`Unexpected read: ${url}`)
  }, store)
  try {
    const projected = await refreshCommunityDirectoryProjection(claims, options)
    assert.equal(projected.listed, false)
    assert.deepEqual(store.buildPublicPage({ now }).members, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
