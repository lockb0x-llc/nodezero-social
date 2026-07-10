import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { CommunityDirectoryStore } from './communityDirectory.js'

const seededWebId = 'https://solid.nodezero.social/lifecycle-user/profile/card#me'

test('pre-opt-in records are absent from public index', () => {
  const store = new CommunityDirectoryStore()
  store.seedRecord({
    webId: seededWebId,
    podUrl: 'https://solid.nodezero.social/lifecycle-user/',
    issuer: 'https://solid.nodezero.social',
  })

  const index = store.buildPublicIndex()
  assert.equal(index.version, 1)
  assert.deepEqual(index.members, [])
})

test('opt-in publishes record to public index', () => {
  const store = new CommunityDirectoryStore()
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

test('opt-out removes record from public index and preserves record state', () => {
  const store = new CommunityDirectoryStore()
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
