import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CommunityDirectoryStore } from './communityDirectory.js'
import type { CommunityDirectoryPersistence } from './communityDirectoryPersistence.js'

const seededWebId = 'https://solid.nodezero.social/lifecycle-user/profile/card#me'
const now = new Date('2026-08-02T00:00:00.000Z')

function withStore(run: (store: CommunityDirectoryStore, path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'nz-community-directory-'))
  const path = join(dir, 'community-directory.json')
  try {
    run(new CommunityDirectoryStore({ persistenceFilePath: path }), path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

void test('pre-opt-in records are absent from public index', () => {
  withStore((store) => {
    store.seedRecord({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
    })

    const index = store.buildPublicIndex()
    assert.equal(index.version, 1)
    assert.deepEqual(index.members, [])
    assert.equal('tombstones' in store.buildPublicPage({ now }), false)
  })
})

void test('opt-in publishes record to public index', () => {
  withStore((store) => {
    store.seedRecord({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
    })

    const updated = store.setListing(seededWebId, true)
    assert.equal(updated?.listed, true)

    const index = store.buildPublicIndex()
    assert.equal(index.members.length, 1)
    assert.equal(index.members[0]?.webId, seededWebId)
    assert.equal(index.members[0]?.listed, true)
  })
})

void test('opt-out removes record from public index and preserves record state', () => {
  withStore((store) => {
    store.seedRecord({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
    })

    store.setListing(seededWebId, true)
    const updated = store.setListing(seededWebId, false)
    assert.equal(updated?.listed, false)

    const index = store.buildPublicIndex()
    assert.deepEqual(index.members, [])

    const internal = store.getByWebId(seededWebId)
    assert.equal(internal?.listed, false)
  })
})

void test('store persists records across re-initialization', () => {
  withStore((store, path) => {
    store.seedRecord({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
    })
    store.setListing(seededWebId, true)

    const rehydrated = new CommunityDirectoryStore({ persistenceFilePath: path })
    const index = rehydrated.buildPublicIndex()

    assert.equal(index.members.length, 1)
    assert.equal(index.members[0]?.webId, seededWebId)
    assert.equal(index.members[0]?.listed, true)
  })
})

void test('manifest projection publishes only allowlisted public fields and provenance', () => {
  withStore((store) => {
    const projected = store.refreshProjection({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: true,
      publicIndexing: true,
      consentUpdatedAt: '2026-08-01T12:00:00.000Z',
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      sourceRevision: '"manifest-v1"',
      manifest: {
        publishedAt: '2026-08-01T12:00:00.000Z',
        expiresAt: '2026-08-08T12:00:00.000Z',
        displayName: 'Alice',
        publicInterests: ['solid'],
        capabilities: ['relationship-requests'],
        inboxUrl: 'https://solid.nodezero.social/lifecycle-user/social/inbox/',
      },
      now: new Date('2026-08-02T00:00:00.000Z'),
    })

    assert.equal(projected.listed, true)
    assert.equal(projected.displayName, 'Alice')
    assert.deepEqual(projected.publicInterests, ['solid'])
    assert.equal(projected.sourceRevision, '"manifest-v1"')
    assert.equal('privateInterests' in projected, false)
    assert.equal('blockedWebIds' in projected, false)
    assert.equal('trustCircleMembers' in projected, false)
  })
})

void test('consent opt-out immediately removes the projection and clears public fields', () => {
  withStore((store) => {
    const base = {
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: true,
      publicIndexing: true,
      consentUpdatedAt: '2026-08-01T12:00:00.000Z',
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      manifest: {
        publishedAt: '2026-08-01T12:00:00.000Z',
        expiresAt: '2026-08-08T12:00:00.000Z',
        displayName: 'Alice',
        publicInterests: ['solid'],
      },
      now: new Date('2026-08-02T00:00:00.000Z'),
    }
    store.refreshProjection(base)
    const removed = store.refreshProjection({
      ...base,
      publicListing: false,
      consentUpdatedAt: '2026-08-02T01:00:00.000Z',
    })

    assert.equal(removed.listed, false)
    assert.equal(removed.displayName, undefined)
    assert.equal(removed.publicInterests, undefined)
    assert.deepEqual(store.buildPublicIndex().members, [])
  })
})

void test('missing or expired manifests cannot remain publicly projected', () => {
  withStore((store) => {
    const base = {
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: true,
      publicIndexing: true,
      consentUpdatedAt: '2026-08-01T12:00:00.000Z',
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      now: new Date('2026-08-02T00:00:00.000Z'),
    }
    assert.equal(store.refreshProjection({ ...base, manifest: null }).listed, false)
    assert.equal(store.refreshProjection({
      ...base,
      manifest: {
        publishedAt: '2026-07-01T00:00:00.000Z',
        expiresAt: '2026-07-02T00:00:00.000Z',
      },
    }).listed, false)
    assert.deepEqual(store.buildPublicIndex().members, [])
  })
})

void test('listing and indexing independently control membership and projected metadata', () => {
  withStore((store) => {
    const base = {
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      consentUpdatedAt: '2026-08-01T12:00:00.000Z',
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      manifest: {
        publishedAt: '2026-08-01T12:00:00.000Z',
        expiresAt: '2026-08-08T12:00:00.000Z',
        displayName: 'Alice',
        publicInterests: ['solid'],
        capabilities: ['relationship-requests'],
      },
      now,
    }
    const listingOnly = store.refreshProjection({
      ...base,
      publicListing: true,
      publicIndexing: false,
    })
    assert.equal(listingOnly.listed, true)
    assert.equal(listingOnly.displayName, 'Alice')
    assert.equal(listingOnly.publicInterests, undefined)
    assert.equal(listingOnly.capabilities, undefined)

    const indexingOnly = store.refreshProjection({
      ...base,
      publicListing: false,
      publicIndexing: true,
    })
    assert.equal(indexingOnly.listed, false)
    assert.deepEqual(store.buildPublicPage({ now }).members, [])
  })
})

void test('public pages are bounded, cursor-stable, and emit deterministic validators', () => {
  withStore((store) => {
    for (const name of ['alice', 'bob', 'carol']) {
      const webId = `https://solid.nodezero.social/${name}/profile/card#me`
      store.seedRecord({
        webId,
        podUrl: `https://solid.nodezero.social/${name}/`,
        issuer: 'https://solid.nodezero.social',
      })
      store.setListing(webId, true)
    }
    const first = store.buildPublicPage({ limit: 2, now })
    const repeated = store.buildPublicPage({ limit: 2, now })
    assert.equal(first.members.length, 2)
    assert.equal(first.nextCursor, first.members[1]?.webId)
    assert.equal(first.etag, repeated.etag)
    const second = store.buildPublicPage({ cursor: first.nextCursor ?? undefined, limit: 2, now })
    assert.equal(second.members.length, 1)
    assert.equal(second.nextCursor, null)
    assert.equal(new Set([...first.members, ...second.members].map((entry) => entry.webId)).size, 3)
  })
})

void test('removal tombstones remain internal and never appear in public pages', () => {
  withStore((store) => {
    store.refreshProjection({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: true,
      publicIndexing: true,
      consentUpdatedAt: '2026-08-01T12:00:00.000Z',
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      manifest: {
        publishedAt: '2026-08-01T12:00:00.000Z',
        expiresAt: '2026-08-08T12:00:00.000Z',
        displayName: 'Alice',
        publicInterests: ['solid'],
      },
      now,
    })
    store.refreshProjection({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: false,
      publicIndexing: false,
      consentUpdatedAt: '2026-08-02T00:00:00.000Z',
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      manifest: null,
      now: new Date('2026-08-02T00:00:00.000Z'),
    })

    const internal = store.getByWebId(seededWebId)
    assert.equal(internal?.removedAt, '2026-08-02T00:00:00.000Z')
    const page = store.buildPublicPage({ now })
    assert.equal('tombstones' in page, false)
    assert.deepEqual(page.members, [])
  })
})

void test('a transient persistence failure does not poison later writes', async () => {
  let upsertCalls = 0
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: () => Promise.resolve([]),
    loadRecord: () => Promise.resolve(null),
    upsertRecord: () => {
      upsertCalls += 1
      return upsertCalls === 1
        ? Promise.reject(new Error('table outage'))
        : Promise.resolve()
    },
    probe: () => Promise.resolve(),
  }
  const store = new CommunityDirectoryStore({ persistence })
  store.seedRecord({
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
  })
  await assert.rejects(store.flush(), /table outage/)
  store.seedRecord({
    webId: `${seededWebId}-second`,
    podUrl: 'https://solid.nodezero.social/lifecycle-user-2/',
    issuer: 'https://solid.nodezero.social',
  })
  await store.flush()
  assert.equal(upsertCalls, 2)
})

void test('concurrent reloads share one backend scan', async () => {
  let loadCalls = 0
  let releaseLoad: (() => void) | null = null
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: (): Promise<[]> => {
      loadCalls += 1
      return new Promise((resolve): void => {
        releaseLoad = (): void => resolve([])
      })
    },
    loadRecord: () => Promise.resolve(null),
    upsertRecord: () => Promise.resolve(),
    probe: () => Promise.resolve(),
  }
  const store = new CommunityDirectoryStore({ persistence })
  const first = store.reload()
  const second = store.reload()
  releaseLoad?.()
  await Promise.all([first, second])
  assert.equal(loadCalls, 1)
})

void test('a failed durable opt-out is immediately suppressed from public pages', async () => {
  let stored = {
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
    listed: true,
    updatedAt: '2026-08-02T01:00:00.000Z',
    consentUpdatedAt: '2026-08-02T01:00:00.000Z',
    manifestExpiresAt: '2026-08-09T01:00:00.000Z',
  }
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: () => Promise.resolve([stored]),
    loadRecord: () => Promise.resolve(stored),
    upsertRecord: () => Promise.reject(new Error('table outage')),
    probe: () => Promise.resolve(),
  }
  const store = new CommunityDirectoryStore({ persistence })
  await store.reload(true)
  store.refreshProjection({
    webId: seededWebId,
    podUrl: stored.podUrl,
    issuer: stored.issuer,
    publicListing: false,
    publicIndexing: false,
    consentUpdatedAt: '2026-08-02T02:00:00.000Z',
    manifest: null,
    manifestUrl: `${stored.podUrl}public/discovery/manifest`,
    now: new Date('2026-08-02T02:00:00.000Z'),
  })
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
  await assert.rejects(store.flush(), /table outage/)
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
  stored = { ...stored }
})

void test('an older full scan cannot overwrite a newer targeted opt-out', async () => {
  const olderOptIn = {
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
    listed: true,
    updatedAt: '2026-08-02T01:00:00.000Z',
    consentUpdatedAt: '2026-08-02T01:00:00.000Z',
    manifestExpiresAt: '2026-08-09T01:00:00.000Z',
  }
  const newerOptOut = {
    ...olderOptIn,
    listed: false,
    updatedAt: '2026-08-02T02:00:00.000Z',
    consentUpdatedAt: '2026-08-02T02:00:00.000Z',
  }
  let releaseScan: ((records: typeof olderOptIn[]) => void) | null = null
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: () => new Promise((resolve) => { releaseScan = resolve }),
    loadRecord: () => Promise.resolve(newerOptOut),
    upsertRecord: () => Promise.resolve(),
    probe: () => Promise.resolve(),
  }
  const store = new CommunityDirectoryStore({ persistence })
  const scan = store.reload(true)
  await store.reloadRecord(seededWebId)
  releaseScan?.([olderOptIn])
  await scan
  assert.equal(store.getByWebId(seededWebId)?.listed, false)
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
})

void test('pending and failed durable opt-ins never enter public pages', async () => {
  let rejectWrite: ((error: Error) => void) | null = null
  let signalWriteStarted: (() => void) | null = null
  const writeStarted = new Promise<void>((resolve): void => {
    signalWriteStarted = resolve
  })
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: () => Promise.resolve([]),
    loadRecord: () => Promise.resolve(null),
    upsertRecord: () => new Promise((resolve, reject): void => {
      void resolve
      rejectWrite = reject
      signalWriteStarted?.()
    }),
    probe: () => Promise.resolve(),
  }
  const store = new CommunityDirectoryStore({ persistence })
  store.refreshProjection({
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
    publicListing: true,
    publicIndexing: false,
    consentUpdatedAt: '2026-08-02T00:00:00.000Z',
    manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
    manifest: {
      publishedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-03T00:00:00.000Z',
    },
    now,
  })
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
  await writeStarted
  assert.ok(rejectWrite)
  rejectWrite?.(new Error('table outage'))
  await assert.rejects(store.flush(), /table outage/)
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
})

void test('a durable listing disappears when its manifest expires after publication', () => {
  withStore((store) => {
    store.refreshProjection({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: true,
      publicIndexing: false,
      consentUpdatedAt: '2026-08-02T00:00:00.000Z',
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      manifest: {
        publishedAt: '2026-08-02T00:00:00.000Z',
        expiresAt: '2026-08-02T01:00:00.000Z',
      },
      now: new Date('2026-08-02T00:30:00.000Z'),
    })
    assert.equal(store.buildPublicPage({ now: new Date('2026-08-02T00:59:00.000Z') }).members.length, 1)
    assert.deepEqual(store.buildPublicPage({ now: new Date('2026-08-02T01:00:00.000Z') }).members, [])
  })
})
