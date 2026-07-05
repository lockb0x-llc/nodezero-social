/**
 * @module DocustreamManager
 *
 * Manages a user's activity/content stream stored in their Solid Pod under
 * `/public/docustream/`. Each item is persisted as a JSON-LD document so that
 * it remains self-describing and portable across Pod implementations.
 *
 * This is the Phase 1 stub implementation – full LDP container listing and
 * comprehensive error recovery will be added in a subsequent phase.
 */

import {
  assertValidStreamItem,
  type StreamItem,
} from './contracts/DocustreamContract.js'

/** The origin source of a stream item. */
export type { StreamItem } from './contracts/DocustreamContract.js'

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Converts a `StreamItem` to a minimal JSON-LD document string. */
function toJsonLd(item: StreamItem): string {
  return JSON.stringify(
    {
      '@context': {
        '@vocab': 'https://schema.org/',
        nodezero: 'https://vocab.nodezero.social/ns#',
        source: 'nodezero:source',
        author: 'author',
        title: 'name',
        content: 'text',
        timestamp: 'datePublished',
        url: 'url',
      },
      '@id': `nodezero:docustream/${item.id}`,
      '@type': 'SocialMediaPosting',
      source: item.source,
      author: item.author,
      ...(item.title !== undefined ? { title: item.title } : {}),
      content: item.content,
      timestamp: item.timestamp,
      ...(item.url !== undefined ? { url: item.url } : {}),
    },
    null,
    2
  )
}

/** Attempts to parse raw JSON-LD text back into a `StreamItem`. Returns `null` on failure. */
function fromJsonLd(text: string): StreamItem | null {
  try {
    const doc = JSON.parse(text) as Record<string, unknown>
    const id = String(doc['@id'] ?? '').replace(/^.*\//, '')
    if (!id) return null
    const item: StreamItem = {
      id,
      source: (doc['source'] as StreamItem['source']) ?? 'nodezero',
      author: String(doc['author'] ?? ''),
      ...(doc['title'] !== undefined ? { title: String(doc['title']) } : {}),
      content: String(doc['content'] ?? ''),
      timestamp: String(doc['timestamp'] ?? new Date().toISOString()),
      ...(doc['url'] !== undefined ? { url: String(doc['url']) } : {}),
    }

    assertValidStreamItem(item)
    return item
  } catch {
    return null
  }
}

// ─── DocustreamManager ────────────────────────────────────────────────────────

/**
 * Reads and writes docustream activity items to a user's Solid Pod.
 *
 * @example
 * ```ts
 * const mgr = new DocustreamManager(session)
 * await mgr.appendActivity('https://alice.solidcommunity.net/', {
 *   id: 'abc123',
 *   source: 'rss',
 *   author: 'Alice',
 *   title: 'My first post',
 *   content: 'Hello world',
 *   timestamp: new Date().toISOString(),
 * })
 * const items = await mgr.listActivities('https://alice.solidcommunity.net/')
 * ```
 */
export class DocustreamManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly session: any) {}

  /**
   * Writes a `StreamItem` as a JSON-LD document to `/public/docustream/<id>.jsonld`
   * in the user's Pod.
   *
   * @param podRoot - Root URL of the user's Pod (trailing slash optional).
   * @param item - The activity item to persist.
   */
  async appendActivity(podRoot: string, item: StreamItem): Promise<void> {
    assertValidStreamItem(item)

    const base = podRoot.replace(/\/$/, '')
    const resourceUrl = `${base}/public/docustream/${item.id}.jsonld`
    const body = toJsonLd(item)

    try {
      const response = await this.session.fetch(resourceUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/ld+json' },
        body,
      })

      if (!response.ok) {
        throw new Error(`Failed to write docustream item ${item.id}: HTTP ${response.status}`)
      }
    } catch (err) {
      throw new Error(
        `Unable to append docustream item ${item.id} at ${resourceUrl}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /**
   * Fetches the container listing at `/public/docustream/` and returns parsed items.
   *
   * Phase 1 stub: attempts to GET the container as Turtle, extract `.jsonld` URLs
   * via a simple regex, then fetches and parses each one. Returns `[]` on any error.
   *
   * @param podRoot - Root URL of the user's Pod (trailing slash optional).
   * @returns Array of parsed {@link StreamItem} objects.
   */
  async listActivities(podRoot: string): Promise<StreamItem[]> {
    const base = podRoot.replace(/\/$/, '')
    const containerUrl = `${base}/public/docustream/`

    try {
      const containerResp = await this.session.fetch(containerUrl, {
        headers: { Accept: 'text/turtle' },
      })

      if (!containerResp.ok) return []

      const turtle: string = await containerResp.text()

      // Extract resource URLs that end in .jsonld from the Turtle listing.
      const jsonldUrls = Array.from(
        turtle.matchAll(/<([^>]+\.jsonld)>/g),
        (m: RegExpMatchArray) => m[1] as string
      )

      const items: StreamItem[] = []

      await Promise.all(
        jsonldUrls.map(async (url) => {
          try {
            const resp = await this.session.fetch(url)
            if (!resp.ok) return
            const text: string = await resp.text()
            const item = fromJsonLd(text)
            if (item) items.push(item)
          } catch {
            // Skip individual fetch failures.
          }
        })
      )

      return items.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    } catch {
      return []
    }
  }
}
