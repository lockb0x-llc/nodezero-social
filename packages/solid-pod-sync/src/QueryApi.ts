import type { StreamItem, StreamSource } from './contracts/DocustreamContract.js'

export type QueryAudience = 'public' | 'foaf' | 'verified' | 'local'

export interface QueryableStreamItem extends StreamItem {
  authorWebId?: string
  intent?: string
  audience?: QueryAudience
  topics?: string[]
  linkedIds?: string[]
}

export interface StreamQuery {
  authorWebIds?: string[]
  sources?: StreamSource[]
  intents?: string[]
  audiences?: QueryAudience[]
  topics?: string[]
  since?: string
  until?: string
  limit?: number
}

export interface QueryIndex {
  byAuthorWebId: Map<string, QueryableStreamItem[]>
  byIntent: Map<string, QueryableStreamItem[]>
  byTopic: Map<string, QueryableStreamItem[]>
}

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

function asSet(values?: string[]): Set<string> | null {
  if (!values || values.length === 0) return null
  return new Set(values.map(normalized))
}

export function buildQueryIndex(items: QueryableStreamItem[]): QueryIndex {
  const byAuthorWebId = new Map<string, QueryableStreamItem[]>()
  const byIntent = new Map<string, QueryableStreamItem[]>()
  const byTopic = new Map<string, QueryableStreamItem[]>()

  for (const item of items) {
    if (item.authorWebId) {
      const key = normalized(item.authorWebId)
      const list = byAuthorWebId.get(key) ?? []
      list.push(item)
      byAuthorWebId.set(key, list)
    }

    if (item.intent) {
      const key = normalized(item.intent)
      const list = byIntent.get(key) ?? []
      list.push(item)
      byIntent.set(key, list)
    }

    for (const topic of item.topics ?? []) {
      const key = normalized(topic)
      const list = byTopic.get(key) ?? []
      list.push(item)
      byTopic.set(key, list)
    }
  }

  return { byAuthorWebId, byIntent, byTopic }
}

export function queryStreamItems(
  items: QueryableStreamItem[],
  query: StreamQuery = {}
): QueryableStreamItem[] {
  const authorSet = asSet(query.authorWebIds)
  const sourceSet = query.sources ? new Set(query.sources) : null
  const intentSet = asSet(query.intents)
  const audienceSet = query.audiences ? new Set(query.audiences) : null
  const topicSet = asSet(query.topics)

  const sinceTs = query.since ? Date.parse(query.since) : Number.NEGATIVE_INFINITY
  const untilTs = query.until ? Date.parse(query.until) : Number.POSITIVE_INFINITY

  const filtered = items.filter((item) => {
    const ts = Date.parse(item.timestamp)
    if (Number.isNaN(ts)) return false
    if (ts < sinceTs || ts > untilTs) return false

    if (authorSet && !authorSet.has(normalized(item.authorWebId ?? ''))) return false
    if (sourceSet && !sourceSet.has(item.source)) return false
    if (intentSet && !intentSet.has(normalized(item.intent ?? ''))) return false
    if (audienceSet && !audienceSet.has(item.audience ?? 'public')) return false

    if (topicSet) {
      const itemTopics = new Set((item.topics ?? []).map(normalized))
      const hasMatch = Array.from(topicSet).some((topic) => itemTopics.has(topic))
      if (!hasMatch) return false
    }

    return true
  })

  const sorted = filtered.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
  const limit = query.limit ?? sorted.length
  return sorted.slice(0, Math.max(0, limit))
}
