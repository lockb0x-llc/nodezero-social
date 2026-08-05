import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildDirectoryEntry, directoryRecommendationRank } from './entryBuilder'

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

void test('buildDirectoryEntry carries the published avatar URL', () => {
  const entry = buildDirectoryEntry({
    candidateWebId: 'https://solid.nodezero.social/alice/profile/card#me',
    effectiveWebId: 'https://solid.nodezero.social/bob/profile/card#me',
    connections: [],
    directoryRecord: {
      webId: 'https://solid.nodezero.social/alice/profile/card#me',
      avatarUrl: 'https://solid.nodezero.social/alice/public/avatar.png',
    },
  })
  assert.equal(entry.avatarUrl, 'https://solid.nodezero.social/alice/public/avatar.png')
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

void test('buildDirectoryEntry keeps connection source when directory metadata exists', () => {
  const selfWebId = 'https://solid.nodezero.social/self/profile/card#me'
  const connectionWebId = 'https://solid.nodezero.social/friend/profile/card#me'

  const entry = buildDirectoryEntry({
    candidateWebId: connectionWebId,
    effectiveWebId: selfWebId,
    connections: [connectionWebId],
    directoryRecord: {
      webId: connectionWebId,
      displayName: 'Directory Friend',
      trustSignals: { verified: true },
    },
  })

  assert.equal(entry.source, 'connection')
  assert.equal(entry.verified, true)
})

void test('buildDirectoryEntry emits stable recommendation reasons and ranks them', () => {
  const shared = buildDirectoryEntry({
    candidateWebId: 'https://solid.nodezero.social/shared/profile/card#me',
    effectiveWebId: 'https://solid.nodezero.social/self/profile/card#me',
    connections: [],
    localPublicInterests: ['Privacy'],
    directoryRecord: {
      webId: 'https://solid.nodezero.social/shared/profile/card#me',
      publicInterests: ['privacy', 'solid'],
    },
  })
  const publicOnly = buildDirectoryEntry({
    candidateWebId: 'https://solid.nodezero.social/public/profile/card#me',
    effectiveWebId: 'https://solid.nodezero.social/self/profile/card#me',
    connections: [],
  })
  assert.deepEqual(shared.recommendationReasons, ['shared-public-interest'])
  assert.equal(directoryRecommendationRank(shared), 2)
  assert.deepEqual(publicOnly.recommendationReasons, ['public-directory'])
  assert.equal(directoryRecommendationRank(publicOnly), 3)
})

void test('legacy-compatible contacts are not labeled as accepted relationships', () => {
  const legacy = buildDirectoryEntry({
    candidateWebId: 'https://solid.nodezero.social/legacy/profile/card#me',
    effectiveWebId: 'https://solid.nodezero.social/self/profile/card#me',
    connections: ['https://solid.nodezero.social/legacy/profile/card#me'],
    acceptedRelationships: [],
  })
  assert.equal(legacy.source, 'connection')
  assert.deepEqual(legacy.recommendationReasons, ['legacy-contact'])
})
