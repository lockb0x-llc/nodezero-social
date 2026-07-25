import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildDirectoryEntry } from './entryBuilder'

void test('buildDirectoryEntry sets verified from trust signal', () => {
  const entry = buildDirectoryEntry({
    candidateWebId: 'https://solid.nodezero.social/alice/profile/card#me',
    effectiveWebId: 'https://solid.nodezero.social/bob/profile/card#me',
    connections: [],
    directoryRecord: {
      webId: 'https://solid.nodezero.social/alice/profile/card#me',
      trustSignals: { verified: true },
    },
  })

  assert.equal(entry.verified, true)
  assert.equal(entry.source, 'directory')
})

void test('buildDirectoryEntry prioritizes profile display name over directory and fallback', () => {
  const entry = buildDirectoryEntry({
    candidateWebId: 'https://solid.nodezero.social/alice/profile/card#me',
    effectiveWebId: 'https://solid.nodezero.social/bob/profile/card#me',
    connections: [],
    profileDisplayName: 'Alice Profile Name',
    directoryRecord: {
      webId: 'https://solid.nodezero.social/alice/profile/card#me',
      displayName: 'Alice Directory Name',
    },
  })

  assert.equal(entry.displayName, 'Alice Profile Name')
})

void test('buildDirectoryEntry marks self and connection source correctly', () => {
  const selfWebId = 'https://solid.nodezero.social/self/profile/card#me'
  const connectionWebId = 'https://solid.nodezero.social/friend/profile/card#me'

  const selfEntry = buildDirectoryEntry({
    candidateWebId: selfWebId,
    effectiveWebId: selfWebId,
    connections: [connectionWebId],
  })
  const connectionEntry = buildDirectoryEntry({
    candidateWebId: connectionWebId,
    effectiveWebId: selfWebId,
    connections: [connectionWebId],
  })

  assert.equal(selfEntry.source, 'self')
  assert.equal(connectionEntry.source, 'connection')
})
