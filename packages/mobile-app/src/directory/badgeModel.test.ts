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

void test('buildDirectoryBadges omits verified when trust signal is false', () => {
  const badges = buildDirectoryBadges({
    isSelf: false,
    isConnected: true,
    isVerified: false,
    inTrustCircle: true,
  })

  assert.deepEqual(badges, [
    { label: 'Connected', kind: 'default' },
    { label: 'In Trust Circle', kind: 'default' },
  ])
})

void test('buildDirectoryBadges supports trust-circle only state', () => {
  const badges = buildDirectoryBadges({
    isSelf: false,
    isConnected: false,
    isVerified: false,
    inTrustCircle: true,
  })

  assert.deepEqual(badges, [{ label: 'In Trust Circle', kind: 'default' }])
})
