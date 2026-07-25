import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildDirectoryBadges } from './badgeModel'

void test('buildDirectoryBadges includes verified badge when record is verified', () => {
  const badges = buildDirectoryBadges({
    isSelf: false,
    isConnected: false,
    isVerified: true,
    inTrustCircle: false,
  })

  assert.deepEqual(badges, [{ label: 'Verified', kind: 'verified' }])
})

void test('buildDirectoryBadges preserves expected badge order', () => {
  const badges = buildDirectoryBadges({
    isSelf: true,
    isConnected: true,
    isVerified: true,
    inTrustCircle: true,
  })

  assert.deepEqual(badges.map((badge) => badge.label), [
    'You',
    'Connected',
    'Verified',
    'In Trust Circle',
  ])
})
