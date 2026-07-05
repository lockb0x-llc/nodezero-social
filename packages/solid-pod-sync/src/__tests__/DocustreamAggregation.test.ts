import { createSyncState } from '../SyncEngine.js'
import { mergeAndQueryActivities } from '../DocustreamAggregation.js'

describe('mergeAndQueryActivities', () => {
  it('dedupes repeated entries across refresh cycles', () => {
    const sourceWebId = 'https://alice.example/profile/card#me'
    const item = {
      id: 'evt-1',
      source: 'nodezero' as const,
      author: 'Alice',
      content: 'hello',
      timestamp: '2026-07-05T12:00:00.000Z',
    }

    const first = mergeAndQueryActivities([
      {
        sourceWebId,
        items: [item],
      },
    ])

    const second = mergeAndQueryActivities(
      [
        {
          sourceWebId,
          items: [item],
        },
      ],
      { state: first.sync.nextState }
    )

    expect(first.items).toHaveLength(1)
    expect(second.items).toHaveLength(1)
    expect(second.sync.duplicates).toBe(1)
  })

  it('applies defaults and query filters after sync merge', () => {
    const state = createSyncState()
    const merged = mergeAndQueryActivities(
      [
        {
          sourceWebId: 'https://alice.example/profile/card#me',
          defaults: { intent: 'announce', audience: 'verified', topics: ['zk'] },
          items: [
            {
              id: 'evt-1',
              source: 'nodezero',
              author: 'Alice',
              content: 'proof update',
              timestamp: '2026-07-05T12:00:00.000Z',
            },
          ],
        },
        {
          sourceWebId: 'https://bob.example/profile/card#me',
          items: [
            {
              id: 'evt-2',
              source: 'rss',
              author: 'Bob',
              content: 'news',
              timestamp: '2026-07-05T13:00:00.000Z',
              intent: 'inform',
              audience: 'public',
              topics: ['solid'],
            },
          ],
        },
      ],
      {
        state,
        query: {
          audiences: ['verified'],
          topics: ['zk'],
        },
      }
    )

    expect(merged.items).toHaveLength(1)
    expect(merged.items[0]?.id).toBe('evt-1')
    expect(merged.items[0]?.authorWebId).toBe('https://alice.example/profile/card#me')
    expect(merged.items[0]?.intent).toBe('announce')
  })
})