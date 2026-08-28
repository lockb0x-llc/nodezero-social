import {
  archivePathForContainer,
  archivePathForResource,
  canonicalizePodResource,
  canonicalizePodRoot,
} from './PodResourcePath.js'
import { parseContainedResourceUrls } from './PodContainerParser.js'
import type {
  PodArchiveEntry,
  PodArchiveExportResult,
  PodArchiveLimits,
  PodArchiveManifest,
  PodArchiveProgress,
  PodArchiveResource,
} from './PodArchiveTypes.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface PodArchiveExporterOptions extends PodArchiveLimits {
  signal?: AbortSignal
  onProgress?: (progress: PodArchiveProgress) => void
}

const DEFAULT_LIMITS: Required<PodArchiveLimits> = {
  maxDepth: 16,
  maxResources: 10_000,
  maxResourceBytes: 32 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  concurrency: 3,
}

export class PodArchiveExporter {
  private readonly options: Required<PodArchiveLimits> & {
    signal?: AbortSignal
    onProgress?: (progress: PodArchiveProgress) => void
  }

  constructor(
    private readonly session: AuthenticatedSession,
    options: PodArchiveExporterOptions = {},
  ) {
    const resolved: Required<PodArchiveLimits> = {
      ...DEFAULT_LIMITS,
      ...options,
    }
    this.options = resolved
    if (options.signal) this.options.signal = options.signal
    if (options.onProgress) this.options.onProgress = options.onProgress
  }

  async export(podUrl: string): Promise<PodArchiveExportResult> {
    const root = canonicalizePodRoot(podUrl)
    const queue: Array<{ url: string; depth: number }> = [{ url: root, depth: 0 }]
    const visited = new Set<string>()
    const entries: PodArchiveEntry[] = []
    const resources: Array<PodArchiveResource & { depth: number; children: string[] }> = []
    const warnings: string[] = []
    let totalBytes = 0
    let completed = 0

    while (queue.length > 0 && resources.length < this.options.maxResources) {
      this.throwIfAborted()
      const batch = queue.splice(0, this.options.concurrency)
      const results = await Promise.all(batch.map(async ({ url, depth }) => {
        if (visited.has(url)) return null
        visited.add(url)
        return this.readResource(root, url, depth)
      }))

      for (const result of results) {
        if (!result) continue
        completed += 1
        if (result.status === 'failed') {
          resources.push(result)
          warnings.push(`${result.sourceUrl}: ${result.error ?? 'resource read failed'}`)
        } else {
          totalBytes += result.size
          if (totalBytes > this.options.maxTotalBytes) {
            throw new PodArchiveError('pod_total_size', `Pod export exceeds ${this.options.maxTotalBytes} bytes.`)
          }
          entries.push(result as PodArchiveEntry)
          resources.push(result)
          if (result.kind === 'container' && result.depth < this.options.maxDepth) {
            for (const child of result.children) {
              try {
                const canonicalChild = canonicalizePodResource(root, child)
                if (!visited.has(canonicalChild)) queue.push({ url: canonicalChild, depth: result.depth + 1 })
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Invalid child resource.'
                warnings.push(`${child}: ${message}`)
                resources.push({
                  sourceUrl: child,
                  archivePath: safeArchivePath(root, child),
                  mediaType: null,
                  etag: null,
                  size: 0,
                  kind: 'failed',
                  status: 'failed',
                  error: message,
                  depth: result.depth + 1,
                  children: [],
                })
              }
            }
          }
        }
        this.options.onProgress?.({
          completed,
          discovered: completed + queue.length,
          totalBytes,
          url: result.sourceUrl,
          status: result.status,
        })
      }
    }

    if (queue.length > 0) warnings.push(`Export stopped at the ${this.options.maxResources} resource limit.`)
    const manifest: PodArchiveManifest = {
      format: 'nodezero-solid-pod',
      formatVersion: 1,
      podUrl: root,
      exportedAt: new Date().toISOString(),
      limits: {
        maxDepth: this.options.maxDepth,
        maxResources: this.options.maxResources,
        maxResourceBytes: this.options.maxResourceBytes,
        maxTotalBytes: this.options.maxTotalBytes,
        concurrency: this.options.concurrency,
      },
      resources: resources.map(({ bytes: _bytes, depth: _depth, children: _children, ...resource }) => resource),
      warnings,
    }
    return { manifest, entries }
  }

  private async readResource(
    root: string,
    sourceUrl: string,
    depth: number,
  ): Promise<PodArchiveResource & { depth: number; children: string[] }> {
    try {
      const response = await this.session.fetch(sourceUrl, {
        headers: { Accept: 'text/turtle, application/ld+json, application/json, */*' },
        redirect: 'error',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > this.options.maxResourceBytes) {
        throw new PodArchiveError('pod_resource_size', `Resource exceeds ${this.options.maxResourceBytes} bytes.`)
      }
      const bytes = await readBoundedBytes(response, this.options.maxResourceBytes, this.options.signal)
      const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || null
      const children = mediaType && (mediaType === 'text/turtle' || mediaType === 'application/ld+json')
        ? parseContainedResourceUrls(bytes, mediaType, sourceUrl)
        : []
      const kind = isContainerResponse(response, bytes, mediaType) || children.length > 0 || sourceUrl === root
        ? 'container'
        : classifyControlResource(sourceUrl)
      return {
        sourceUrl,
        archivePath: kind === 'container'
          ? archivePathForContainer(root, sourceUrl)
          : archivePathForResource(root, sourceUrl),
        mediaType,
        etag: response.headers.get('etag'),
        size: bytes.byteLength,
        kind,
        status: 'exported',
        bytes,
        depth,
        children,
      }
    } catch (error) {
      return {
        sourceUrl,
        archivePath: safeArchivePath(root, sourceUrl),
        mediaType: null,
        etag: null,
        size: 0,
        kind: 'failed',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown resource failure.',
        depth,
        children: [],
      }
    }
  }

  private throwIfAborted(): void {
    if (this.options.signal?.aborted) throw new PodArchiveError('pod_export_cancelled', 'Pod export was cancelled.')
  }
}

export class PodArchiveError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PodArchiveError'
  }
}

function classifyControlResource(url: string): 'resource' | 'acl' | 'acp' {
  const path = new URL(url).pathname.toLowerCase()
  if (path.endsWith('.acl')) return 'acl'
  if (path.endsWith('.acp')) return 'acp'
  return 'resource'
}

function safeArchivePath(root: string, url: string): string {
  try {
    return archivePathForResource(root, url)
  } catch {
    return `pod/.failed/${encodeURIComponent(url)}`
  }
}

function isContainerResponse(response: Response, bytes: Uint8Array, mediaType: string | null): boolean {
  const link = response.headers.get('link') ?? ''
  if (/<http:\/\/www\.w3\.org\/ns\/ldp#(?:Container|BasicContainer)>\s*;\s*rel="?type"?/i.test(link)) {
    return true
  }
  if (mediaType !== 'text/turtle' && mediaType !== 'application/ld+json') return false
  const text = new TextDecoder().decode(bytes)
  return /(?:a|<http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#type>)\s+(?:ldp:)?(?:Container|BasicContainer|<http:\/\/www\.w3\.org\/ns\/ldp#(?:Container|BasicContainer)>)/i.test(text)
}

async function readBoundedBytes(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw new PodArchiveError('pod_export_cancelled', 'Pod export was cancelled.')
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      throw new PodArchiveError('pod_resource_size', `Resource exceeds ${maxBytes} bytes.`)
    }
    return bytes
  }
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel()
      throw new PodArchiveError('pod_export_cancelled', 'Pod export was cancelled.')
    }
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new PodArchiveError('pod_resource_size', `Resource exceeds ${maxBytes} bytes.`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}