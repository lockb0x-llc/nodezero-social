import type { StreamItem } from './contracts/DocustreamContract.js'

export interface SyncEnvelope {
  eventId: string
  sourceWebId: string
  resourceId: string
  timestamp: string
  item: StreamItem
}

export interface SyncState {
  seenEventIds: Set<string>
  records: Map<string, SyncEnvelope>
}

export interface SyncBatchResult {
  nextState: SyncState
  applied: number
  duplicates: number
  conflicts: number
}

export interface SerializedSyncState {
  seenEventIds: string[]
  records: SyncEnvelope[]
}

export function createSyncState(): SyncState {
  return {
    seenEventIds: new Set(),
    records: new Map(),
  }
}

export function buildSyncEventId(sourceWebId: string, item: StreamItem): string {
  return `${sourceWebId}::${item.id}::${item.timestamp}`
}

function resourceKey(envelope: SyncEnvelope): string {
  return `${envelope.sourceWebId}::${envelope.resourceId}`
}

export function serializeSyncState(state: SyncState): SerializedSyncState {
  return {
    seenEventIds: Array.from(state.seenEventIds),
    records: Array.from(state.records.values()),
  }
}

export function deserializeSyncState(serialized?: SerializedSyncState | null): SyncState {
  if (!serialized) {
    return createSyncState()
  }

  const nextState = createSyncState()

  for (const eventId of serialized.seenEventIds ?? []) {
    if (typeof eventId === 'string' && eventId.length > 0) {
      nextState.seenEventIds.add(eventId)
    }
  }

  for (const record of serialized.records ?? []) {
    if (!record || typeof record.eventId !== 'string') continue
    if (typeof record.sourceWebId !== 'string' || typeof record.resourceId !== 'string') continue
    nextState.records.set(resourceKey(record), record)
  }

  return nextState
}

function shouldReplace(existing: SyncEnvelope, incoming: SyncEnvelope): boolean {
  const existingTs = Date.parse(existing.timestamp)
  const incomingTs = Date.parse(incoming.timestamp)

  if (Number.isNaN(existingTs) || Number.isNaN(incomingTs)) {
    return incoming.eventId > existing.eventId
  }

  if (incomingTs > existingTs) return true
  if (incomingTs < existingTs) return false

  // Deterministic tie-break when timestamps are equal.
  return incoming.eventId > existing.eventId
}

export function applySyncBatch(state: SyncState, incoming: SyncEnvelope[]): SyncBatchResult {
  const nextState: SyncState = {
    seenEventIds: new Set(state.seenEventIds),
    records: new Map(state.records),
  }

  let applied = 0
  let duplicates = 0
  let conflicts = 0

  for (const envelope of incoming) {
    if (nextState.seenEventIds.has(envelope.eventId)) {
      duplicates += 1
      continue
    }

    nextState.seenEventIds.add(envelope.eventId)

    const key = resourceKey(envelope)
    const existing = nextState.records.get(key)

    if (!existing) {
      nextState.records.set(key, envelope)
      applied += 1
      continue
    }

    conflicts += 1
    if (shouldReplace(existing, envelope)) {
      nextState.records.set(key, envelope)
      applied += 1
    }
  }

  return {
    nextState,
    applied,
    duplicates,
    conflicts,
  }
}
