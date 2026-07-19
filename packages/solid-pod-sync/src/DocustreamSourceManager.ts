import {
  assertValidDocustreamSource,
  type DocustreamSource,
  type DocustreamSourceType,
} from './contracts/DocustreamSourceContract.js'
import { type PodLayoutManager, type PodPolicyMatrix } from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface DocustreamSourceManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
    ensureDocustreamLayoutAndPolicy?: PodLayoutManager['ensureDocustreamLayoutAndPolicy']
  }
}

export interface UpsertDocustreamSourceInput {
  url: string
  title?: string
  enabled?: boolean
  type?: DocustreamSourceType
}

const SOURCE_REGISTRY_FILE = 'docustream-sources.jsonld'
const DOCUSTREAM_SOURCE_WRITE_LOCK_ERROR =
  'DocuStream source mutations are temporarily disabled during the storage refactor lock.'

function sourceRegistryUrl(podRoot: string): string {
  const base = podRoot.replace(/\/$/, '')
  return `${base}/public/${SOURCE_REGISTRY_FILE}`
}


function fromJsonLd(payload: string): DocustreamSource[] {
  try {
    const parsed = JSON.parse(payload) as { sources?: unknown }
    if (!Array.isArray(parsed.sources)) return []

    const sources: DocustreamSource[] = []
    for (const candidate of parsed.sources) {
      if (!candidate || typeof candidate !== 'object') continue
      const record = candidate as Partial<DocustreamSource>

      const source: DocustreamSource = {
        id: String(record.id ?? ''),
        type: (record.type ?? 'rss') as DocustreamSourceType,
        url: String(record.url ?? ''),
        enabled: Boolean(record.enabled),
        createdAt: String(record.createdAt ?? ''),
        updatedAt: String(record.updatedAt ?? ''),
        ...(record.title ? { title: String(record.title) } : {}),
        ...(record.lastIngestedAt ? { lastIngestedAt: String(record.lastIngestedAt) } : {}),
        ...(record.lastError ? { lastError: String(record.lastError) } : {}),
      }

      try {
        assertValidDocustreamSource(source)
        sources.push(source)
      } catch {
        // Skip invalid records from corrupted or legacy payloads.
      }
    }

    return sources
  } catch {
    return []
  }
}

export class DocustreamSourceManager {
  constructor(
    private readonly session: AuthenticatedSession,
    options: DocustreamSourceManagerOptions = {}
  ) {
    void options
  }

  async listSources(podRoot: string): Promise<DocustreamSource[]> {
    const registryUrl = sourceRegistryUrl(podRoot)
    try {
      const response = await this.session.fetch(registryUrl, {
        headers: { Accept: 'application/ld+json, application/json' },
      })
      if (!response.ok) {
        const authHeader = response.headers.get('www-authenticate') ?? 'none'
        console.warn(
          `[DocustreamSourceManager] listSources failed for ${registryUrl}: ` +
            `HTTP ${response.status} ${response.statusText}; www-authenticate=${authHeader}`
        )
        return []
      }

      const payload = await response.text()
      return fromJsonLd(payload).sort((left, right) => left.url.localeCompare(right.url))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      console.warn(`[DocustreamSourceManager] listSources exception for ${registryUrl}: ${message}`)
      return []
    }
  }

  async upsertSource(podRoot: string, input: UpsertDocustreamSourceInput): Promise<DocustreamSource> {
    void podRoot
    void input
    await Promise.resolve()
    throw new Error(DOCUSTREAM_SOURCE_WRITE_LOCK_ERROR)
  }

  async setSourceEnabled(podRoot: string, sourceId: string, enabled: boolean): Promise<DocustreamSource | null> {
    void podRoot
    void sourceId
    void enabled
    await Promise.resolve()
    throw new Error(DOCUSTREAM_SOURCE_WRITE_LOCK_ERROR)
  }

  async removeSource(podRoot: string, sourceId: string): Promise<void> {
    void podRoot
    void sourceId
    await Promise.resolve()
    throw new Error(DOCUSTREAM_SOURCE_WRITE_LOCK_ERROR)
  }

  async recordIngestionResult(podRoot: string, sourceId: string, lastError?: string): Promise<DocustreamSource | null> {
    void podRoot
    void sourceId
    void lastError
    await Promise.resolve()
    throw new Error(DOCUSTREAM_SOURCE_WRITE_LOCK_ERROR)
  }

}
