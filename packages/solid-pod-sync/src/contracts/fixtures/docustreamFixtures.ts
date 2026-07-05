import type { StreamItem } from '../DocustreamContract.js'

export const validDocustreamFixtures: StreamItem[] = [
  {
    id: 'evt_20260705_001',
    source: 'nodezero',
    author: 'Alice',
    title: 'Kickoff note',
    content: 'Layer 1 implementation started.',
    timestamp: '2026-07-05T10:00:00.000Z',
    url: 'https://staging.nodezero.social/feed/evt_20260705_001',
  },
  {
    id: 'evt_20260705_002',
    source: 'rss',
    author: 'NodeZero Updates',
    content: 'New roadmap update published.',
    timestamp: '2026-07-05T11:30:00Z',
  },
]

export const invalidDocustreamFixtures: unknown[] = [
  {
    id: 'bad id with spaces',
    source: 'nodezero',
    author: 'Alice',
    content: 'Invalid id format',
    timestamp: '2026-07-05T10:00:00.000Z',
  },
  {
    id: 'evt_bad_timestamp',
    source: 'rss',
    author: 'NodeZero Updates',
    content: 'Invalid timestamp',
    timestamp: '07/05/2026',
  },
  {
    id: 'evt_bad_url',
    source: 'x',
    author: 'Alice',
    content: 'Invalid URL',
    timestamp: '2026-07-05T10:00:00.000Z',
    url: 'ftp://example.com/post/1',
  },
]
