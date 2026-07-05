import {
  applySyncBatch,
  buildSyncEventId,
  createSyncState,
  deserializeSyncState,
  serializeSyncState,
  type SyncEnvelope,
} from '../SyncEngine.js'

function makeEnvelope(
  sourceWebId: string,
  resourceId: string,
  timestamp: string,
  eventId?: string
): SyncEnvelope {
  const item = {
    id: resourceId,
    source: 'nodezero' as const,
    author: 'Alice',
    content: `event ${resourceId}`,
    timestamp,
  }

  return {
    sourceWebId,
    resourceId,
    timestamp,
    item,
    eventId: eventId ?? buildSyncEventId(sourceWebId, item),
  }
}

describe('applySyncBatch', () => {
  it('dedupes repeated event ids', () => {
    const state = createSyncState()
    const event = makeEnvelope('https://alice.example/profile/card#me', 'evt-1', '2026-07-05T12:00:00.000Z')

    const first = applySyncBatch(state, [event])
    const second = applySyncBatch(first.nextState, [event])

    expect(first.applied).toBe(1)
    expect(second.duplicates).toBe(1)
    expect(second.applied).toBe(0)
  })

  it('resolves conflicts using latest timestamp', () => {
    const state = createSyncState()
    const older = makeEnvelope('https://alice.example/profile/card#me', 'evt-1', '2026-07-05T12:00:00.000Z', 'a')
    const newer = makeEnvelope('https://alice.example/profile/card#me', 'evt-1', '2026-07-05T12:10:00.000Z', 'b')

    const first = applySyncBatch(state, [older])
    const second = applySyncBatch(first.nextState, [newer])

    expect(second.conflicts).toBe(1)
    const record = second.nextState.records.get('https://alice.example/profile/card#me::evt-1')
    expect(record?.eventId).toBe('b')
  })

  it('keeps deterministic tie-break when timestamps are equal', () => {
    const state = createSyncState()
    const eventA = makeEnvelope('https://alice.example/profile/card#me', 'evt-1', '2026-07-05T12:00:00.000Z', 'a')
    const eventB = makeEnvelope('https://alice.example/profile/card#me', 'evt-1', '2026-07-05T12:00:00.000Z', 'z')

    const first = applySyncBatch(state, [eventA])
    const second = applySyncBatch(first.nextState, [eventB])

    const record = second.nextState.records.get('https://alice.example/profile/card#me::evt-1')
    expect(record?.eventId).toBe('z')
  })
})

describe('sync state serialization', () => {
  it('round-trips sync state through serialized format', () => {
    const sourceWebId = 'https://alice.example/profile/card#me'
    const state = createSyncState()
    const event = makeEnvelope(sourceWebId, 'evt-1', '2026-07-05T12:00:00.000Z')
    const merged = applySyncBatch(state, [event]).nextState

    const serialized = serializeSyncState(merged)
    const restored = deserializeSyncState(serialized)

    expect(restored.seenEventIds.has(event.eventId)).toBe(true)
    expect(restored.records.get(`${sourceWebId}::evt-1`)?.eventId).toBe(event.eventId)
  })

  it('returns empty state for missing serialized payload', () => {
    const restored = deserializeSyncState(undefined)

    expect(restored.seenEventIds.size).toBe(0)
    expect(restored.records.size).toBe(0)
  })
})
