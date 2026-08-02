import { buildDirectoryPageUrl, parseDirectoryPage } from './directorySourceShared'
import type { DirectoryPage } from './types'

export interface DirectoryPageCacheEntry {
  etag: string
  page: DirectoryPage
}

export async function fetchDirectoryPage(input: {
  endpoint: string
  fetch: typeof globalThis.fetch
  cursor?: string
  limit?: number
  cached?: DirectoryPageCacheEntry
}): Promise<{ page: DirectoryPage; cache: DirectoryPageCacheEntry | null }> {
  const url = buildDirectoryPageUrl(input.endpoint, {
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
  })
  const response = await input.fetch(url, {
    headers: {
      accept: 'application/json',
      ...(input.cached ? { 'if-none-match': input.cached.etag } : {}),
    },
  })
  if (response.status === 304 && input.cached) {
    return { page: input.cached.page, cache: input.cached }
  }
  if (!response.ok) throw new Error(`Community directory returned HTTP ${response.status}.`)
  const page = parseDirectoryPage(await response.json(), response.headers.get('etag'))
  return {
    page,
    cache: page.etag ? { etag: page.etag, page } : null,
  }
}
