import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CommunityDirectoryStore } from './communityDirectory.js'

const seededWebId = 'https://solid.nodezero.social/lifecycle-user/profile/card#me'

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
