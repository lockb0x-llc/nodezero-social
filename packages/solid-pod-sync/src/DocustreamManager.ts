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
import { type PodLayoutManager, type PodPolicyMatrix } from './PodLayoutManager.js'

const DOCUSTREAM_WRITE_LOCK_ERROR =
  'DocuStream writes are temporarily disabled during the storage refactor lock.'

/** The origin source of a stream item. */
export type { StreamItem } from './contracts/DocustreamContract.js'

export interface DocustreamManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
    ensureDocustreamLayoutAndPolicy?: PodLayoutManager['ensureDocustreamLayoutAndPolicy']
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

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

function extractJsonLdUrls(payload: unknown): string[] {
  const found = new Set<string>()

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }

    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' && value.includes('.jsonld')) {
        found.add(value)
      }
      return
    }

    const record = value as Record<string, unknown>
    for (const [key, nested] of Object.entries(record)) {
      if (key === '@id' && typeof nested === 'string' && nested.includes('.jsonld')) {
        found.add(nested)
      }
      visit(nested)
    }
  }

  visit(payload)
  return Array.from(found)
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
  constructor(
    private readonly session: any,
    _options: DocustreamManagerOptions = {}
  ) {
    void _options
  }

  /**
   * Writes a `StreamItem` as a JSON-LD document to `/public/docustream/<id>.jsonld`
   * in the user's Pod.
   *
   * @param podRoot - Root URL of the user's Pod (trailing slash optional).
   * @param item - The activity item to persist.
   */
  async appendActivity(podRoot: string, item: StreamItem): Promise<void> {
    void podRoot
    void item
    await Promise.resolve()
    throw new Error(DOCUSTREAM_WRITE_LOCK_ERROR)
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

      const listingBody: string = await containerResp.text()
      const contentType = (containerResp.headers?.get?.('content-type') ?? '').toLowerCase()

      let jsonldUrls: string[] = []

      if (contentType.includes('json') || listingBody.trim().startsWith('{') || listingBody.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(listingBody)
          jsonldUrls = extractJsonLdUrls(parsed)
        } catch {
          jsonldUrls = []
        }
      }

      if (jsonldUrls.length === 0) {
        // Fallback for Pod implementations returning Turtle container listings.
        jsonldUrls = Array.from(
          listingBody.matchAll(/<([^>]+\.jsonld)>/g),
          (m: RegExpMatchArray) => m[1] as string
        )
      }

      const normalizedUrls = Array.from(
        new Set(
          jsonldUrls
            .map((candidate) => {
              try {
                return new URL(candidate, containerUrl).toString()
              } catch {
                return ''
              }
            })
            .filter((candidate) => candidate.length > 0)
        )
      )

      const items: StreamItem[] = []

      await Promise.all(
        normalizedUrls.map(async (url) => {
          try {
            const resp = await this.session.fetch(url, {
              headers: {
                Accept: 'application/ld+json, application/json;q=0.9, text/turtle;q=0.8',
              },
            })
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
