import {
  assertValidDocustreamSource,
  type DocustreamSource,
  type DocustreamSourceType,
} from './contracts/DocustreamSourceContract.js'
import { type PodLayoutManager, type PodPolicyMatrix } from './PodLayoutManager.js'
import {
  getSolidDataset,
  getThing,
  getUrlAll,
} from '@inrupt/solid-client'

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
const NZ_DOCUSTREAM_REGISTRY = 'https://nodezero.social/ns#docustreamSourceRegistry'
const NZ_DOCUSTREAM_CONTAINER = 'https://nodezero.social/ns#docustreamContainer'
const NZ_DOCUSTREAM_SOURCE = 'https://nodezero.social/ns#docustreamSource'
const MAX_WRITE_ATTEMPTS = 3

interface RegistrySnapshot {
  sources: DocustreamSource[]
  etag: string | null
  exists: boolean
}

function nowIso(): string {
  return new Date().toISOString()
}

function sourceRegistryUrl(podRoot: string): string {
  const base = podRoot.replace(/\/$/, '')
  return `${base}/public/${SOURCE_REGISTRY_FILE}`
}

function docustreamContainerUrl(podRoot: string): string {
  return `${podRoot.replace(/\/$/, '')}/public/docustream/`
}

function profileWebId(podRoot: string): string {
  return `${podRoot.replace(/\/$/, '')}/profile/card#me`
}

function sparqlIri(value: string): string {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('DocuStream profile links must use http(s) URLs.')
  }
  return `<${parsed.toString().replace(/>/g, '%3E')}>`
}

function normalizeSourceUrl(raw: string): string {
  const parsed = new URL(raw.trim())
  parsed.hash = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
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
  return JSON.stringify({
    '@context': {
      '@vocab': 'https://vocab.nodezero.social/docustream-source#',
      items: 'sources',
      id: '@id',
      type: '@type',
    },
    '@id': 'nodezero:docustream-sources',
    '@type': 'DocustreamSourceRegistry',
    sources,
  }, null, 2)
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
    this.options = options
  }

  private readonly options: DocustreamSourceManagerOptions

  async listSources(podRoot: string): Promise<DocustreamSource[]> {
    return (await this.readRegistry(podRoot)).sources
  }

  private async readRegistry(podRoot: string): Promise<RegistrySnapshot> {
    const registryUrl = sourceRegistryUrl(podRoot)
    const response = await this.session.fetch(registryUrl, {
      headers: { Accept: 'application/ld+json, application/json' },
    })
    if (response.status === 404) return { sources: [], etag: null, exists: false }
    if (!response.ok) {
      throw new Error(`Failed to read DocuStream source registry: HTTP ${response.status}`)
    }
    return {
      sources: fromJsonLd(await response.text()).sort((left, right) => left.url.localeCompare(right.url)),
      etag: response.headers.get('etag'),
      exists: true,
    }
  }

  async upsertSource(podRoot: string, input: UpsertDocustreamSourceInput): Promise<DocustreamSource> {
    await this.ensurePodLayoutIfEnabled(podRoot)
    const normalizedUrl = normalizeSourceUrl(input.url)
    let saved: DocustreamSource | null = null
    await this.mutateRegistry(podRoot, (existing) => {
      const previous = existing.find((source) => source.url === normalizedUrl)
      const timestamp = nowIso()
      saved = {
        id: previous?.id ?? sourceIdFromUrl(normalizedUrl),
        type: input.type ?? previous?.type ?? 'rss',
        url: normalizedUrl,
        enabled: input.enabled ?? previous?.enabled ?? true,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...(input.title?.trim()
          ? { title: input.title.trim() }
          : previous?.title ? { title: previous.title } : {}),
        ...(previous?.lastIngestedAt ? { lastIngestedAt: previous.lastIngestedAt } : {}),
        ...(previous?.lastError ? { lastError: previous.lastError } : {}),
      }
      assertValidDocustreamSource(saved)
      return [...existing.filter((source) => source.id !== saved?.id), saved]
    })
    if (!saved) throw new Error('DocuStream source was not persisted.')
    return saved
  }

  async setSourceEnabled(podRoot: string, sourceId: string, enabled: boolean): Promise<DocustreamSource | null> {
    let updatedSource: DocustreamSource | null = null
    await this.mutateRegistry(podRoot, (existing) => existing.map((source) => {
      if (source.id !== sourceId) return source
      updatedSource = { ...source, enabled, updatedAt: nowIso() }
      assertValidDocustreamSource(updatedSource)
      return updatedSource
    }))
    return updatedSource
  }

  async removeSource(podRoot: string, sourceId: string): Promise<void> {
    await this.mutateRegistry(
      podRoot,
      (existing) => existing.filter((source) => source.id !== sourceId),
    )
  }

  async recordIngestionResult(podRoot: string, sourceId: string, lastError?: string): Promise<DocustreamSource | null> {
    let updatedSource: DocustreamSource | null = null
    await this.mutateRegistry(podRoot, (existing) => existing.map((source) => {
      if (source.id !== sourceId) return source
      const timestamp = nowIso()
      const withoutError: DocustreamSource = { ...source }
      delete withoutError.lastError
      const nextSource: DocustreamSource = lastError
        ? { ...source, updatedAt: timestamp, lastError: lastError.slice(0, 512) }
        : { ...withoutError, updatedAt: timestamp, lastIngestedAt: timestamp }
      assertValidDocustreamSource(nextSource)
      updatedSource = nextSource
      return nextSource
    }))
    return updatedSource
  }

  private async mutateRegistry(
    podRoot: string,
    mutate: (sources: DocustreamSource[]) => DocustreamSource[],
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const snapshot = await this.readRegistry(podRoot)
      if (snapshot.exists && !snapshot.etag) {
        throw new Error('DocuStream source registry is missing an ETag; refusing an unsafe update.')
      }
      const next = mutate(snapshot.sources)
        .slice()
        .sort((left, right) => left.url.localeCompare(right.url))
      for (const source of next) assertValidDocustreamSource(source)
      const response = await this.session.fetch(sourceRegistryUrl(podRoot), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/ld+json',
          ...(snapshot.exists
            ? snapshot.etag ? { 'If-Match': snapshot.etag } : {}
            : { 'If-None-Match': '*' }),
        },
        body: toJsonLd(next),
      })
      if (response.status === 412 && attempt < MAX_WRITE_ATTEMPTS - 1) continue
      if (!response.ok) {
        throw new Error(`Failed to write DocuStream source registry: HTTP ${response.status}`)
      }
      const persisted = await this.readRegistry(podRoot)
      if (JSON.stringify(persisted.sources) !== JSON.stringify(next)) {
        throw new Error('DocuStream source registry read-back did not match the requested update.')
      }
      await this.syncProfileLinks(podRoot, next)
      return
    }
    throw new Error('DocuStream source registry changed concurrently; retry the operation.')
  }

  private async syncProfileLinks(podRoot: string, sources: DocustreamSource[]): Promise<void> {
    const webId = profileWebId(podRoot)
    const datasetUrl = webId.split('#')[0]
    const predicates = [NZ_DOCUSTREAM_REGISTRY, NZ_DOCUSTREAM_CONTAINER, NZ_DOCUSTREAM_SOURCE]
    const inserts = [
      `${sparqlIri(webId)} ${sparqlIri(NZ_DOCUSTREAM_REGISTRY)} ${sparqlIri(sourceRegistryUrl(podRoot))} .`,
      `${sparqlIri(webId)} ${sparqlIri(NZ_DOCUSTREAM_CONTAINER)} ${sparqlIri(docustreamContainerUrl(podRoot))} .`,
      ...sources.map(
        (source) => `${sparqlIri(webId)} ${sparqlIri(NZ_DOCUSTREAM_SOURCE)} ${sparqlIri(source.url)} .`,
      ),
    ]
    const patch = [
      'DELETE {',
      `  ${sparqlIri(webId)} ?predicate ?value .`,
      '}',
      'INSERT {',
      ...inserts.map((entry) => `  ${entry}`),
      '}',
      'WHERE {',
      `  VALUES ?predicate { ${predicates.map(sparqlIri).join(' ')} }`,
      `  OPTIONAL { ${sparqlIri(webId)} ?predicate ?value . }`,
      '}',
    ].join('\n')
    const patchResponse = await this.session.fetch(datasetUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/sparql-update' },
      body: patch,
    })
    if (!patchResponse.ok) {
      throw new Error(`Failed to link DocuStream sources from the WebID profile: HTTP ${patchResponse.status}`)
    }

    const verifiedDataset = await getSolidDataset(datasetUrl, { fetch: this.session.fetch })
    const verifiedProfile = getThing(verifiedDataset, webId)
    if (!verifiedProfile) throw new Error('The WebID profile link update could not be verified.')
    const expectedSources = sources.map((source) => source.url).sort()
    const persistedSources = getUrlAll(verifiedProfile, NZ_DOCUSTREAM_SOURCE).sort()
    if (
      getUrlAll(verifiedProfile, NZ_DOCUSTREAM_REGISTRY)[0] !== sourceRegistryUrl(podRoot) ||
      getUrlAll(verifiedProfile, NZ_DOCUSTREAM_CONTAINER)[0] !== docustreamContainerUrl(podRoot) ||
      JSON.stringify(persistedSources) !== JSON.stringify(expectedSources)
    ) {
      throw new Error('DocuStream profile links did not persist exactly as requested.')
    }
  }

  private async ensurePodLayoutIfEnabled(podRoot: string): Promise<void> {
    if (!this.options.enablePodBootstrap) return
    const manager = this.options.podLayoutManager
    if (manager?.ensureDocustreamLayoutAndPolicy) {
      await manager.ensureDocustreamLayoutAndPolicy(podRoot, this.options.policyMatrix?.docustream ?? 'public-read')
      return
    }
    if (manager) await manager.ensureDefaultLayoutAndPolicies(podRoot, this.options.policyMatrix)
  }

}
