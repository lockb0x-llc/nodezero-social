import type { StreamItem } from './contracts/DocustreamContract.js'
import {
  queryStreamItems,
  type QueryAudience,
  type QueryableStreamItem,
  type StreamQuery,
} from './QueryApi.js'
import {
  applySyncBatch,
  buildSyncEventId,
  createSyncState,
  type SyncBatchResult,
  type SyncState,
} from './SyncEngine.js'

export type EnrichedStreamItem = StreamItem &
  Pick<Partial<QueryableStreamItem>, 'authorWebId' | 'intent' | 'audience' | 'topics' | 'linkedIds'>

export interface ActivitySourceBatch {
  sourceWebId: string
  items: EnrichedStreamItem[]
  defaults?: {
    intent?: string
    audience?: QueryAudience
    topics?: string[]
  }
}

export interface MergeAndQueryOptions {
  state?: SyncState
  query?: StreamQuery
}

export interface MergeAndQueryResult {
  sync: SyncBatchResult
  items: QueryableStreamItem[]
}

function toQueryable(item: EnrichedStreamItem, sourceWebId: string, defaults?: ActivitySourceBatch['defaults']): QueryableStreamItem {
  const intent = item.intent ?? defaults?.intent
  const audience = item.audience ?? defaults?.audience
  const topics = item.topics ?? defaults?.topics

  return {
    ...item,
    authorWebId: item.authorWebId ?? sourceWebId,
    ...(intent !== undefined ? { intent } : {}),
    ...(audience !== undefined ? { audience } : {}),
    ...(topics !== undefined ? { topics } : {}),
  }
}

export function mergeAndQueryActivities(
  batches: ActivitySourceBatch[],
  options: MergeAndQueryOptions = {}
): MergeAndQueryResult {
  const currentState = options.state ?? createSyncState()

  const incoming = batches.flatMap((batch) =>
    batch.items.map((item) => ({
      eventId: buildSyncEventId(batch.sourceWebId, item),
      sourceWebId: batch.sourceWebId,
      resourceId: item.id,
      timestamp: item.timestamp,
      item,
    }))
  )

  const sync = applySyncBatch(currentState, incoming)

  const defaultBySource = new Map<string, ActivitySourceBatch['defaults']>()
  for (const batch of batches) {
    defaultBySource.set(batch.sourceWebId, batch.defaults)
  }

  const queryableItems = Array.from(sync.nextState.records.values()).map((record) =>
    toQueryable(record.item as EnrichedStreamItem, record.sourceWebId, defaultBySource.get(record.sourceWebId))
  )

  return {
    sync,
    items: queryStreamItems(queryableItems, options.query),
  }
}