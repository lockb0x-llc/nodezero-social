import { buildQueryIndex, queryStreamItems, type QueryableStreamItem } from '../QueryApi.js'

const FIXTURES: QueryableStreamItem[] = [
  {
    id: 'evt-1',
    source: 'nodezero',
    author: 'Alice',
    authorWebId: 'https://alice.example/profile/card#me',
    content: 'Proof verified',
    timestamp: '2026-07-05T12:00:00.000Z',
    intent: 'announce',
    audience: 'verified',
    topics: ['zk', 'identity'],
  },
  {
    id: 'evt-2',
    source: 'rss',
    author: 'News',
    authorWebId: 'https://feed.example/profile/card#me',
    content: 'Solid update',
    timestamp: '2026-07-05T11:00:00.000Z',
    intent: 'inform',
    audience: 'public',
    topics: ['solid'],
  },
  {
    id: 'evt-3',
    source: 'x',
    author: 'Bob',
    authorWebId: 'https://bob.example/profile/card#me',
    content: 'Grid check-in',
    timestamp: '2026-07-05T13:00:00.000Z',
    intent: 'social',
    audience: 'local',
    topics: ['local', 'h3'],
  },
]

describe('queryStreamItems', () => {
  it('returns newest-first timeline by default', () => {
    const result = queryStreamItems(FIXTURES)
    expect(result.map((item) => item.id)).toEqual(['evt-3', 'evt-1', 'evt-2'])
  })

  it('filters by audience, intent, and topic', () => {
    const result = queryStreamItems(FIXTURES, {
      audiences: ['verified'],
      intents: ['announce'],
      topics: ['zk'],
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('evt-1')
  })

  it('applies date window and limit', () => {
    const result = queryStreamItems(FIXTURES, {
      since: '2026-07-05T11:30:00.000Z',
      until: '2026-07-05T13:00:00.000Z',
      limit: 1,
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('evt-3')
  })
})

describe('buildQueryIndex', () => {
  it('indexes stream items by author, intent, and topic', () => {
    const index = buildQueryIndex(FIXTURES)

    expect(index.byAuthorWebId.get('https://alice.example/profile/card#me')?.[0]?.id).toBe('evt-1')
    expect(index.byIntent.get('social')?.[0]?.id).toBe('evt-3')
    expect(index.byTopic.get('solid')?.[0]?.id).toBe('evt-2')
  })
})
