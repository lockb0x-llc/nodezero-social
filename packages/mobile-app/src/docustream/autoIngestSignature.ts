import type { DocustreamSource } from '@nodezero/solid-pod-sync'

export const AUTO_INGEST_MIN_INTERVAL_MS = 15 * 60_000

export function autoIngestSignature(sources: DocustreamSource[]): string {
  const now = Date.now()
  return sources
    .filter((source) => {
      if (!source.enabled) return false
      if (!source.lastIngestedAt) return true
      const lastIngestedAt = Date.parse(source.lastIngestedAt)
      return !Number.isFinite(lastIngestedAt) || now - lastIngestedAt >= AUTO_INGEST_MIN_INTERVAL_MS
    })
    .map((source) => source.id)
    .sort()
    .join('|')
}
