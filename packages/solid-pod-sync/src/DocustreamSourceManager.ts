import {
  assertValidDocustreamSource,
  type DocustreamSource,
  type DocustreamSourceType,
} from './contracts/DocustreamSourceContract.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface DocustreamSourceManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: Pick<PodLayoutManager, 'ensureDefaultLayoutAndPolicies'>
}

export interface UpsertDocustreamSourceInput {
  url: string
  title?: string
  enabled?: boolean
  type?: DocustreamSourceType
}

const SOURCE_REGISTRY_FILE = 'docustream-sources.jsonld'

function nowIso(): string {
  return new Date().toISOString()
}

function sourceRegistryUrl(podRoot: string): string {
  const base = podRoot.replace(/\/$/, '')
  return `${base}/public/${SOURCE_REGISTRY_FILE}`
}

function normalizeSourceUrl(raw: string): string {
  const trimmed = raw.trim()
  const parsed = new URL(trimmed)
  parsed.hash = ''

  const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/'
  parsed.pathname = normalizedPath

  return parsed.toString()
}

function sourceIdFromUrl(url: string): string {
  let hash = 2166136261
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return `rss_${(hash >>> 0).toString(36)}`
}

function toJsonLd(sources: DocustreamSource[]): string {
  return JSON.stringify(
    {
      '@context': {
        '@vocab': 'https://vocab.nodezero.social/docustream-source#',
        items: 'sources',
        id: '@id',
        type: '@type',
      },
      '@id': 'nodezero:docustream-sources',
      '@type': 'DocustreamSourceRegistry',
      sources,
    },
    null,
    2
  )
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
    private readonly options: DocustreamSourceManagerOptions = {}
  ) {}

  async listSources(podRoot: string): Promise<DocustreamSource[]> {
    const registryUrl = sourceRegistryUrl(podRoot)
    try {
      const response = await this.session.fetch(registryUrl, {
        headers: { Accept: 'application/ld+json, application/json' },
      })
      if (!response.ok) return []

      const payload = await response.text()
      return fromJsonLd(payload).sort((left, right) => left.url.localeCompare(right.url))
    } catch {
      return []
    }
  }

  async upsertSource(podRoot: string, input: UpsertDocustreamSourceInput): Promise<DocustreamSource> {
    await this.ensurePodLayoutIfEnabled(podRoot)

    const normalizedUrl = normalizeSourceUrl(input.url)
    const existing = await this.listSources(podRoot)
    const timestamp = nowIso()

    const existingByUrl = existing.find((source) => source.url === normalizedUrl)
    const id = existingByUrl?.id ?? sourceIdFromUrl(normalizedUrl)

    const nextSource: DocustreamSource = {
      id,
      type: input.type ?? existingByUrl?.type ?? 'rss',
      url: normalizedUrl,
      enabled: input.enabled ?? existingByUrl?.enabled ?? true,
      createdAt: existingByUrl?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...(input.title?.trim() ? { title: input.title.trim() } : existingByUrl?.title ? { title: existingByUrl.title } : {}),
      ...(existingByUrl?.lastIngestedAt ? { lastIngestedAt: existingByUrl.lastIngestedAt } : {}),
      ...(existingByUrl?.lastError ? { lastError: existingByUrl.lastError } : {}),
    }

    assertValidDocustreamSource(nextSource)

    const withoutCurrent = existing.filter((source) => source.id !== id)
    const updated = [...withoutCurrent, nextSource]
    await this.writeRegistry(podRoot, updated)

    return nextSource
  }

  async setSourceEnabled(podRoot: string, sourceId: string, enabled: boolean): Promise<DocustreamSource | null> {
    const existing = await this.listSources(podRoot)
    const target = existing.find((source) => source.id === sourceId)
    if (!target) return null

    const nextSource: DocustreamSource = {
      ...target,
      enabled,
      updatedAt: nowIso(),
    }
    assertValidDocustreamSource(nextSource)

    const updated = existing.map((source) => (source.id === sourceId ? nextSource : source))
    await this.writeRegistry(podRoot, updated)

    return nextSource
  }

  async removeSource(podRoot: string, sourceId: string): Promise<void> {
    const existing = await this.listSources(podRoot)
    const updated = existing.filter((source) => source.id !== sourceId)
    if (updated.length === existing.length) return
    await this.writeRegistry(podRoot, updated)
  }

  async recordIngestionResult(podRoot: string, sourceId: string, lastError?: string): Promise<DocustreamSource | null> {
    const existing = await this.listSources(podRoot)
    const target = existing.find((source) => source.id === sourceId)
    if (!target) return null

    const nextSource: DocustreamSource = {
      ...target,
      updatedAt: nowIso(),
      ...(lastError
        ? { lastError: lastError.slice(0, 512) }
        : { lastIngestedAt: nowIso() }),
    }

    if (!lastError) {
      delete nextSource.lastError
    }

    assertValidDocustreamSource(nextSource)

    const updated = existing.map((source) => (source.id === sourceId ? nextSource : source))
    await this.writeRegistry(podRoot, updated)

    return nextSource
  }

  private async writeRegistry(podRoot: string, sources: DocustreamSource[]): Promise<void> {
    const registryUrl = sourceRegistryUrl(podRoot)
    const body = toJsonLd(sources)

    const response = await this.session.fetch(registryUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/ld+json' },
      body,
    })

    if (!response.ok) {
      throw new Error(`Failed to write source registry at ${registryUrl}: HTTP ${response.status}`)
    }
  }

  private async ensurePodLayoutIfEnabled(podRoot: string): Promise<void> {
    if (!this.options.enablePodBootstrap) return

    const podLayoutManager =
      this.options.podLayoutManager ?? new PodLayoutManager({ fetch: this.session.fetch })

    await podLayoutManager.ensureDefaultLayoutAndPolicies(
      podRoot,
      this.options.policyMatrix ?? DEFAULT_POLICY_MATRIX
    )
  }
}
