import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { collectNsfwScanUrls, deriveProfileNsfwFlag, hasNsfwSignals } from './nsfwDecision'

void test('collectNsfwScanUrls returns profile urls in stable order', () => {
  assert.deepEqual(
    collectNsfwScanUrls({
      externalUrl: 'https://example.com/profile',
      avatarUrl: 'https://example.com/avatar.png',
    }),
    ['https://example.com/profile', 'https://example.com/avatar.png'],
  )
})

void test('hasNsfwSignals detects known NSFW domains', () => {
  assert.equal(
    hasNsfwSignals({ externalUrl: 'https://onlyfans.com/nodezero' }),
    true,
  )
  assert.equal(
    hasNsfwSignals({ externalUrl: 'https://example.com' }),
    false,
  )
})

void test('deriveProfileNsfwFlag preserves explicit NSFW flag', () => {
  assert.equal(
    deriveProfileNsfwFlag({ externalUrl: 'https://example.com' }, true),
    true,
  )
})
