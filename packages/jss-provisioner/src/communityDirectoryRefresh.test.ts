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

function baseOptions(fetchImpl: typeof globalThis.fetch, store = createTestStore()): {
  store: CommunityDirectoryStore
  options: Parameters<typeof refreshCommunityDirectoryProjection>[1]
} {
  globalThis.fetch = fetchImpl
  return {
    store,
    options: {
      cssBaseUrl: 'https://solid.example',
      credentialStore: {
        findByWebId: () => Promise.resolve({
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
      mintToken: () => Promise.resolve({
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
  const calls: string[] = []
  const originalFetch = globalThis.fetch
  const { store, options } = baseOptions((input, init) => {
    const url = String(input)
    calls.push(url)
    assert.equal(new Headers(init?.headers).get('authorization'), 'DPoP solid-token')
    if (url === consentUrl) return Promise.resolve(response(`
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:ownerWebId <${alice}> ; nz:publicListing true ; nz:publicIndexing true ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-01T12:00:00.000Z" .
    `, consentUrl))
    return Promise.resolve(response(`
      @prefix nz: <https://nodezero.social/ns#> .
      <${manifestUrl}#manifest> a nz:DiscoveryManifest ; nz:version 1 ;
        nz:webId <${alice}> ; nz:publishedAt "2026-08-01T12:00:00.000Z" ;
        nz:expiresAt "2026-08-08T12:00:00.000Z" ; nz:displayName "Alice" ;
        nz:publicInterest "solid" .
    `, manifestUrl, '"manifest-v1"'))
  })
  try {
    const projected = await refreshCommunityDirectoryProjection(claims, options)
    assert.equal(projected.listed, true)
    assert.equal(projected.displayName, 'Alice')
    assert.equal(projected.sourceRevision, '"manifest-v1"')
    assert.equal(store.buildPublicIndex().members.length, 1)
    assert.deepEqual(calls, [consentUrl, manifestUrl])
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
    consentUpdatedAt: '2026-08-01T00:00:00.000Z',
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
    return Promise.resolve(response(`
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:ownerWebId <${alice}> ; nz:publicListing false ; nz:publicIndexing false ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-02T00:00:00.000Z" .
    `, consentUrl))
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
    consentUpdatedAt: '2026-08-01T00:00:00.000Z',
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
    if (url === consentUrl) return Promise.resolve(response(`
      @prefix nz: <https://nodezero.social/ns#> .
      <${consentUrl}#consent> a nz:DiscoveryConsent ; nz:version 1 ;
        nz:ownerWebId <${alice}> ; nz:publicListing true ; nz:publicIndexing true ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-02T00:00:00.000Z" .
    `, consentUrl))
    return Promise.resolve(response(`
      @prefix nz: <https://nodezero.social/ns#> .
      <${manifestUrl}#manifest> a nz:DiscoveryManifest ; nz:version 1 ;
        nz:webId <https://mallory.example/profile/card#me> ;
        nz:publishedAt "2026-08-01T00:00:00.000Z" ;
        nz:expiresAt "2026-08-08T00:00:00.000Z" .
    `, manifestUrl))
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
