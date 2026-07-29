import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DocustreamSource } from '@nodezero/solid-pod-sync'
import {
  AUTO_INGEST_MIN_INTERVAL_MS,
  autoIngestSignature,
} from './autoIngestSignature.js'

const source: DocustreamSource = {
  id: 'rss_feed',
  type: 'rss',
  url: 'https://example.com/feed.xml',
  enabled: true,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
}

void test('ignores ingestion metadata updates', () => {
  const initial = autoIngestSignature([source])
  const afterIngest = autoIngestSignature([
    {
      ...source,
      updatedAt: '2026-07-29T00:01:00.000Z',
      lastIngestedAt: new Date().toISOString(),
    },
  ])
  const afterError = autoIngestSignature([
    {
      ...source,
      updatedAt: '2026-07-29T00:02:00.000Z',
      lastError: 'temporary failure',
    },
  ])

  assert.equal(initial, 'rss_feed')
  assert.equal(afterIngest, '')
  assert.equal(afterError, initial)
})

void test('changes only when enabled source membership changes', () => {
  assert.equal(autoIngestSignature([{ ...source, enabled: false }]), '')
  assert.equal(autoIngestSignature([source, { ...source, id: 'rss_other' }]), 'rss_feed|rss_other')
})

void test('allows automatic ingestion again after the cooldown', () => {
  assert.equal(
    autoIngestSignature([
      {
        ...source,
        lastIngestedAt: new Date(Date.now() - AUTO_INGEST_MIN_INTERVAL_MS - 1).toISOString(),
      },
    ]),
    'rss_feed',
  )
})
