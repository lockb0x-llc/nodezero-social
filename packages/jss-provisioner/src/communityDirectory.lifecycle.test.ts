import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

function publishListedRecord(store: CommunityDirectoryStore, webId: string, podUrl: string): void {
  store.refreshProjection({
    webId,
    podUrl,
    issuer: 'https://solid.nodezero.social',
    publicListing: true,
    publicIndexing: false,
    publicationRevision: 1,
    publicationUpdatedAt: now.toISOString(),
    manifestUrl: `${podUrl}public/discovery/manifest`,
    manifest: {
      publishedAt: now.toISOString(),
      expiresAt: '2026-08-09T00:00:00.000Z',
    },
    now,
  })
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

void test('listed records without a current manifest expiry remain private', () => {
  withStore((store) => {
    store.seedRecord({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
    })
    store.setListing(seededWebId, true)
    assert.deepEqual(store.buildPublicPage({ now }).members, [])
  })
})

void test('opt-in publishes record to public index', () => {
  withStore((store) => {
    store.seedRecord({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
    })

    publishListedRecord(store, seededWebId, 'https://solid.nodezero.social/lifecycle-user/')
    const updated = store.getByWebId(seededWebId)
    assert.equal(updated?.listed, true)

    const page = store.buildPublicPage({ now })
    assert.equal(page.members.length, 1)
    assert.equal(page.members[0]?.webId, seededWebId)
  })
})

void test('opt-out removes record from public index and preserves record state', () => {
  withStore((store) => {
    store.seedRecord({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
    })

    publishListedRecord(store, seededWebId, 'https://solid.nodezero.social/lifecycle-user/')
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
    publishListedRecord(store, seededWebId, 'https://solid.nodezero.social/lifecycle-user/')

    const rehydrated = new CommunityDirectoryStore({ persistenceFilePath: path })
    const index = rehydrated.buildPublicPage({ now })

    assert.equal(index.members.length, 1)
    assert.equal(index.members[0]?.webId, seededWebId)
  })
})

void test('rehydrated generationless legacy listings remain private', () => {
  withStore((_store, path) => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        records: [
          {
            webId: seededWebId,
            podUrl: 'https://solid.nodezero.social/lifecycle-user/',
            issuer: 'https://solid.nodezero.social',
            listed: true,
            updatedAt: now.toISOString(),
            manifestExpiresAt: '2026-08-09T00:00:00.000Z',
          },
        ],
      }),
      'utf8'
    )

    const rehydrated = new CommunityDirectoryStore({ persistenceFilePath: path })
    assert.deepEqual(rehydrated.buildPublicPage({ now }).members, [])
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
      publicationRevision: 1,
      publicationUpdatedAt: '2026-08-01T12:00:00.000Z',
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
    assert.equal(projected.publicInterests, undefined)
    assert.equal(projected.capabilities, undefined)
    assert.equal(projected.inboxUrl, undefined)
    assert.equal(projected.sourceRevision, '"manifest-v1"')
    assert.equal('privateInterests' in projected, false)
    assert.equal('blockedWebIds' in projected, false)
    assert.equal('trustCircleMembers' in projected, false)
    const publicRecord = store.buildPublicPage({ now: new Date('2026-08-02T00:00:00.000Z') })
      .members[0]
    assert.deepEqual(Object.keys(publicRecord ?? {}).sort(), [
      'displayName',
      'webId',
    ])
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
      publicationUpdatedAt: '2026-08-01T12:00:00.000Z',
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
      publicationUpdatedAt: '2026-08-02T01:00:00.000Z',
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
      publicationUpdatedAt: '2026-08-01T12:00:00.000Z',
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      now: new Date('2026-08-02T00:00:00.000Z'),
    }
    assert.equal(store.refreshProjection({ ...base, manifest: null }).listed, false)
    assert.equal(
      store.refreshProjection({
        ...base,
        manifest: {
          publishedAt: '2026-07-01T00:00:00.000Z',
          expiresAt: '2026-07-02T00:00:00.000Z',
        },
      }).listed,
      false
    )
    assert.deepEqual(store.buildPublicIndex().members, [])
  })
})

void test('far-future and overlong manifests cannot enter the public projection', () => {
  withStore((store) => {
    const base = {
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: true,
      publicIndexing: false,
      publicationUpdatedAt: now.toISOString(),
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      now,
    }
    assert.equal(
      store.refreshProjection({
        ...base,
        manifest: {
          publishedAt: '2030-01-01T00:00:00.000Z',
          expiresAt: '2030-01-08T00:00:00.000Z',
        },
      }).listed,
      false
    )
    assert.equal(
      store.refreshProjection({
        ...base,
        manifest: {
          publishedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 8 * 24 * 60 * 60_000).toISOString(),
        },
      }).listed,
      false
    )
  })
})

void test('listing and indexing independently control membership and projected metadata', () => {
  withStore((store) => {
    const base = {
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicationRevision: 1,
      publicationUpdatedAt: '2026-08-01T12:00:00.000Z',
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
      publishListedRecord(store, webId, `https://solid.nodezero.social/${name}/`)
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

void test('public pages exclude owners withdrawn from the active cohort before pagination', () => {
  withStore((store) => {
    const alice = 'https://solid.nodezero.social/alice/profile/card#me'
    const bob = 'https://solid.nodezero.social/bob/profile/card#me'
    publishListedRecord(store, alice, 'https://solid.nodezero.social/alice/')
    publishListedRecord(store, bob, 'https://solid.nodezero.social/bob/')
    const page = store.buildPublicPage({
      limit: 1,
      now,
      include: (record) => record.webId === bob,
    })
    assert.deepEqual(
      page.members.map((record) => record.webId),
      [bob]
    )
    assert.equal(page.nextCursor, null)
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
      publicationRevision: 1,
      publicationUpdatedAt: '2026-08-01T12:00:00.000Z',
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
      publicationRevision: 2,
      publicationUpdatedAt: '2026-08-02T00:00:00.000Z',
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
      return upsertCalls === 1 ? Promise.reject(new Error('table outage')) : Promise.resolve()
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

void test('authoritative targeted reload replaces an optimistic rejected listing', async () => {
  const storedSuppression = {
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
    listed: false,
    updatedAt: '2026-08-02T02:00:00.000Z',
    publicationRevision: 6,
    publicationUpdatedAt: '2026-08-02T02:00:00.000Z',
    suppressionRevision: 6,
    suppressedAt: '2026-08-02T02:00:00.000Z',
  }
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: () => Promise.resolve([]),
    loadRecord: () => Promise.resolve(storedSuppression),
    upsertRecord: () => Promise.resolve(),
    probe: () => Promise.resolve(),
  }
  const store = new CommunityDirectoryStore({ persistence })
  store.refreshProjection({
    webId: seededWebId,
    podUrl: storedSuppression.podUrl,
    issuer: storedSuppression.issuer,
    publicListing: true,
    publicIndexing: false,
    publicationRevision: 6,
    publicationUpdatedAt: '2026-08-02T03:00:00.000Z',
    manifestUrl: `${storedSuppression.podUrl}public/discovery/manifest`,
    manifest: {
      publishedAt: '2026-08-02T03:00:00.000Z',
      expiresAt: '2026-08-09T03:00:00.000Z',
    },
    now: new Date('2026-08-02T03:00:00.000Z'),
  })
  await store.flush()
  assert.equal(store.getByWebId(seededWebId)?.listed, true)

  await store.reloadRecord(seededWebId, true)
  assert.equal(store.getByWebId(seededWebId)?.listed, false)
  assert.equal(store.getCommittedByWebId(seededWebId)?.listed, false)
  assert.equal(store.getDurableByWebId(seededWebId)?.listed, false)
})

void test('targeted reload preserves a newer local opt-out over stale durable listing', async () => {
  const storedListing = {
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
    listed: true,
    updatedAt: '2026-08-02T01:00:00.000Z',
    publicationRevision: 4,
    publicationUpdatedAt: '2026-08-02T01:00:00.000Z',
    manifestExpiresAt: '2026-08-09T01:00:00.000Z',
  }
  let releaseSuppressionWrite!: () => void
  const suppressionWrite = new Promise<void>((resolve) => {
    releaseSuppressionWrite = resolve
  })
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: () => Promise.resolve([storedListing]),
    loadRecord: () => Promise.resolve(storedListing),
    upsertRecord: async () => {
      await suppressionWrite
    },
    probe: () => Promise.resolve(),
  }
  const store = new CommunityDirectoryStore({ persistence })
  await store.reload(true)
  store.refreshProjection({
    webId: seededWebId,
    podUrl: storedListing.podUrl,
    issuer: storedListing.issuer,
    publicListing: false,
    publicIndexing: false,
    publicationRevision: 5,
    publicationUpdatedAt: '2026-08-02T02:00:00.000Z',
    manifestUrl: `${storedListing.podUrl}public/discovery/manifest`,
    manifest: null,
    suppressed: true,
    now: new Date('2026-08-02T02:00:00.000Z'),
  })

  await store.reloadRecord(seededWebId, true)
  assert.equal(store.getByWebId(seededWebId)?.listed, false)
  assert.equal(store.getCommittedByWebId(seededWebId)?.listed, false)
  assert.equal(store.getDurableByWebId(seededWebId)?.listed, true)

  releaseSuppressionWrite()
  await store.flush()
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

void test('forced reload joins an old scan and performs one follow-up scan', async () => {
  let loadCalls = 0
  let releaseFirstLoad!: () => void
  const firstLoad = new Promise<void>((resolve) => {
    releaseFirstLoad = resolve
  })
  const freshRecord = {
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
    listed: false,
    updatedAt: '2026-08-02T02:00:00.000Z',
    publicationRevision: 5,
    publicationUpdatedAt: '2026-08-02T02:00:00.000Z',
    suppressionRevision: 5,
    suppressedAt: '2026-08-02T02:00:00.000Z',
  }
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: async () => {
      loadCalls += 1
      const call = loadCalls
      if (call === 1) await firstLoad
      return call === 1 ? [] : [freshRecord]
    },
    loadRecord: () => Promise.resolve(null),
    upsertRecord: () => Promise.resolve(),
    probe: () => Promise.resolve(),
  }
  const store = new CommunityDirectoryStore({ persistence })
  const oldScan = store.reload()
  const forced = store.reload(true)
  const duplicateForced = store.reload(true)
  releaseFirstLoad()
  await Promise.all([oldScan, forced, duplicateForced])

  assert.equal(loadCalls, 2)
  assert.equal(store.getDurableByWebId(seededWebId)?.suppressionRevision, 5)
})

void test('full reload removes public rows absent from shared persistence', async () => {
  const storedListing = {
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
    listed: true,
    updatedAt: now.toISOString(),
    publicationRevision: 4,
    publicationUpdatedAt: now.toISOString(),
    manifestExpiresAt: '2026-08-09T00:00:00.000Z',
  }
  let records = [storedListing]
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: () => Promise.resolve(records),
    loadRecord: () => Promise.resolve(null),
    upsertRecord: () => Promise.resolve(),
    probe: () => Promise.resolve(),
  }
  const store = new CommunityDirectoryStore({ persistence })
  await store.reload(true)
  assert.equal(store.buildPublicPage({ now }).members.length, 1)

  records = []
  await store.reload(true)
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
  assert.equal(store.getDurableByWebId(seededWebId), null)
})

void test('targeted missing row removes a stale public listing', async () => {
  const storedListing = {
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
    listed: true,
    updatedAt: now.toISOString(),
    publicationRevision: 4,
    publicationUpdatedAt: now.toISOString(),
    manifestExpiresAt: '2026-08-09T00:00:00.000Z',
  }
  let record = storedListing
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: () => Promise.resolve([storedListing]),
    loadRecord: () => Promise.resolve(record),
    upsertRecord: () => Promise.resolve(),
    probe: () => Promise.resolve(),
  }
  const store = new CommunityDirectoryStore({ persistence })
  await store.reload(true)
  assert.equal(store.buildPublicPage({ now }).members.length, 1)

  record = null
  await store.reloadRecord(seededWebId, true)
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
  assert.equal(store.getDurableByWebId(seededWebId), null)
})

void test('a failed durable opt-out is immediately suppressed from public pages', async () => {
  let stored = {
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
    listed: true,
    updatedAt: '2026-08-02T01:00:00.000Z',
    publicationRevision: 4,
    publicationUpdatedAt: '2026-08-02T01:00:00.000Z',
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
    publicationRevision: 5,
    publicationUpdatedAt: '2026-08-02T02:00:00.000Z',
    manifest: null,
    manifestUrl: `${stored.podUrl}public/discovery/manifest`,
    now: new Date('2026-08-02T02:00:00.000Z'),
  })
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
  await assert.rejects(store.flush(), /table outage/)
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
  assert.equal(store.getDurableByWebId(seededWebId)?.listed, true)
  assert.equal(store.getDurableByWebId(seededWebId)?.publicationRevision, 4)
  assert.equal(store.getDurableByWebId(seededWebId)?.suppressedAt, undefined)
  stored = { ...stored }
})

void test('explicit suppression hides a durable listing before persistence completes', async () => {
  let releaseWrite: (() => void) | null = null
  let writeCount = 0
  let signalWriteStarted!: () => void
  const writeStarted = new Promise<void>((resolve) => {
    signalWriteStarted = resolve
  })
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: () => Promise.resolve([]),
    loadRecord: () => Promise.resolve(null),
    upsertRecord: () => {
      writeCount += 1
      if (writeCount === 1) return Promise.resolve()
      return new Promise((resolve) => {
        releaseWrite = resolve
        signalWriteStarted()
      })
    },
    probe: () => Promise.resolve(),
  }
  const store = new CommunityDirectoryStore({ persistence })
  store.refreshProjection({
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
    publicListing: true,
    publicIndexing: false,
    publicationRevision: 1,
    publicationUpdatedAt: now.toISOString(),
    manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
    manifest: {
      publishedAt: now.toISOString(),
      expiresAt: '2026-08-09T00:00:00.000Z',
    },
    now,
  })
  await store.flush()
  store.setListing(seededWebId, false)
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
  await writeStarted
  releaseWrite?.()
  await store.flush()
})

void test('an older full scan cannot overwrite a newer targeted opt-out', async () => {
  const olderOptIn = {
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
    listed: true,
    updatedAt: '2026-08-02T01:00:00.000Z',
    publicationUpdatedAt: '2026-08-02T01:00:00.000Z',
    manifestExpiresAt: '2026-08-09T01:00:00.000Z',
  }
  const newerOptOut = {
    ...olderOptIn,
    listed: false,
    updatedAt: '2026-08-02T02:00:00.000Z',
    publicationUpdatedAt: '2026-08-02T02:00:00.000Z',
  }
  let releaseScan: ((records: (typeof olderOptIn)[]) => void) | null = null
  const persistence: CommunityDirectoryPersistence = {
    loadRecords: () =>
      new Promise((resolve) => {
        releaseScan = resolve
      }),
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
    upsertRecord: () =>
      new Promise((resolve, reject): void => {
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
    publicationRevision: 1,
    publicationUpdatedAt: '2026-08-02T00:00:00.000Z',
    manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
    manifest: {
      publishedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-03T00:00:00.000Z',
    },
    now,
  })
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
  await writeStarted
  assert.equal(store.getCommittedByWebId(seededWebId), null)
  assert.ok(rejectWrite)
  rejectWrite?.(new Error('table outage'))
  await assert.rejects(store.flush(), /table outage/)
  assert.deepEqual(store.buildPublicPage({ now }).members, [])
})

void test('same-generation completion replaces an incomplete projection', () => {
  withStore((store) => {
    const base = {
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: true,
      publicIndexing: false,
      publicationUpdatedAt: now.toISOString(),
      publicationRevision: 4,
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      now,
    }
    store.refreshProjection({ ...base, manifest: null })
    store.refreshProjection({
      ...base,
      manifest: {
        publishedAt: now.toISOString(),
        expiresAt: '2026-08-09T00:00:00.000Z',
        displayName: 'Alice',
      },
    })
    assert.equal(store.buildPublicPage({ now }).members[0]?.displayName, 'Alice')
  })
})

void test('suppression blocks same-generation relisting until a newer generation wins', () => {
  withStore((store) => {
    const base = {
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: true,
      publicIndexing: false,
      publicationUpdatedAt: now.toISOString(),
      publicationRevision: 4,
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      manifest: {
        publishedAt: now.toISOString(),
        expiresAt: '2026-08-09T00:00:00.000Z',
        displayName: 'Alice',
      },
      now,
    }
    store.refreshProjection({ ...base, suppressed: true })
    store.refreshProjection(base)
    assert.deepEqual(store.buildPublicPage({ now }).members, [])
    store.refreshProjection({
      ...base,
      publicationRevision: 5,
      publicationUpdatedAt: '2026-08-02T00:01:00.000Z',
    })
    assert.equal(store.buildPublicPage({ now }).members.length, 1)
  })
})

void test('stale suppression cannot overwrite a newer committed listing', () => {
  withStore((store) => {
    const base = {
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: true,
      publicIndexing: false,
      publicationUpdatedAt: '2026-08-02T00:01:00.000Z',
      publicationRevision: 5,
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      manifest: {
        publishedAt: now.toISOString(),
        expiresAt: '2026-08-09T00:00:00.000Z',
        displayName: 'Alice',
      },
      now,
    }
    store.refreshProjection(base)
    store.refreshProjection({
      ...base,
      publicationRevision: 4,
      publicationUpdatedAt: '2026-08-02T00:00:00.000Z',
      manifest: null,
      suppressed: true,
    })
    assert.equal(store.buildPublicPage({ now }).members.length, 1)
  })
})

void test('generationless authoritative opt-out suppresses an existing generated listing', () => {
  withStore((store) => {
    const base = {
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: true,
      publicIndexing: false,
      publicationUpdatedAt: '2026-08-02T00:01:00.000Z',
      publicationRevision: 5,
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      manifest: {
        publishedAt: now.toISOString(),
        expiresAt: '2026-08-09T00:00:00.000Z',
      },
      now,
    }
    store.refreshProjection(base)
    const { publicationRevision, ...generationlessBase } = base
    assert.equal(publicationRevision, 5)
    const suppressed = store.refreshProjection({
      ...generationlessBase,
      publicListing: false,
      publicationUpdatedAt: now.toISOString(),
      manifest: null,
      suppressed: true,
    })
    assert.equal(suppressed.listed, false)
    assert.equal(suppressed.suppressionRevision, 5)
    assert.deepEqual(store.buildPublicPage({ now }).members, [])
  })
})

void test('a durable listing disappears when its manifest expires after publication', () => {
  withStore((store) => {
    store.refreshProjection({
      webId: seededWebId,
      podUrl: 'https://solid.nodezero.social/lifecycle-user/',
      issuer: 'https://solid.nodezero.social',
      publicListing: true,
      publicIndexing: false,
      publicationRevision: 1,
      publicationUpdatedAt: '2026-08-02T00:00:00.000Z',
      manifestUrl: 'https://solid.nodezero.social/lifecycle-user/public/discovery/manifest',
      manifest: {
        publishedAt: '2026-08-02T00:00:00.000Z',
        expiresAt: '2026-08-02T01:00:00.000Z',
      },
      now: new Date('2026-08-02T00:30:00.000Z'),
    })
    assert.equal(
      store.buildPublicPage({ now: new Date('2026-08-02T00:59:00.000Z') }).members.length,
      1
    )
    assert.deepEqual(
      store.buildPublicPage({ now: new Date('2026-08-02T01:00:00.000Z') }).members,
      []
    )
  })
})
