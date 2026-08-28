import {
  canonicalizePodResource,
  canonicalizePodRoot,
} from './PodResourcePath.js'
import type {
  PodArchiveEntry,
  PodArchiveManifest,
  PodArchiveRestoreItem,
  PodArchiveRestoreOptions,
  PodArchiveRestoreReport,
} from './PodArchiveTypes.js'
import { PodArchiveError } from './PodArchiveExporter.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface PodArchiveRestorerOptions extends PodArchiveRestoreOptions {
  maxResourceBytes?: number
  maxTotalBytes?: number
}

const DEFAULT_MAX_RESOURCE_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024

export class PodArchiveRestorer {
  private readonly options: PodArchiveRestorerOptions

  constructor(private readonly session: AuthenticatedSession, options: PodArchiveRestorerOptions = {}) {
    this.options = { conflictPolicy: 'fail', ...options }
  }

  async dryRun(
    targetPodUrl: string,
    manifest: PodArchiveManifest,
    entries: PodArchiveEntry[],
  ): Promise<PodArchiveRestoreReport> {
    return this.run(targetPodUrl, manifest, entries, true)
  }

  async restore(
    targetPodUrl: string,
    manifest: PodArchiveManifest,
    entries: PodArchiveEntry[],
  ): Promise<PodArchiveRestoreReport> {
    if (this.options.dryRun !== false) {
      throw new PodArchiveError('pod_restore_requires_confirmation', 'Restore writes require dryRun: false.')
    }
    return this.run(targetPodUrl, manifest, entries, false)
  }

  private async run(
    targetPodUrl: string,
    manifest: PodArchiveManifest,
    entries: PodArchiveEntry[],
    dryRun: boolean,
  ): Promise<PodArchiveRestoreReport> {
    const targetRoot = canonicalizePodRoot(targetPodUrl)
    validateManifest(manifest)
    const resourcesByPath = new Map(manifest.resources.map((resource) => [resource.archivePath, resource]))
    const warnings: string[] = []
    const items: PodArchiveRestoreItem[] = []
    let totalBytes = 0

    for (const entry of sortRestoreEntries(entries)) {
      this.throwIfAborted()
      const manifestResource = resourcesByPath.get(entry.archivePath)
      if (!manifestResource || manifestResource.status !== 'exported') {
        items.push({
          archivePath: entry.archivePath,
          targetUrl: '',
          kind: 'failed',
          action: 'failed',
          status: 'failed',
          error: 'Archive entry is not represented as an exported manifest resource.',
        })
        continue
      }
      if (manifestResource.sourceUrl !== entry.sourceUrl || manifestResource.kind !== entry.kind) {
        throw new PodArchiveError('pod_restore_manifest_mismatch', `Manifest mismatch for ${entry.archivePath}.`)
      }
      if (entry.bytes.byteLength !== manifestResource.size) {
        throw new PodArchiveError('pod_restore_size_mismatch', `Size mismatch for ${entry.archivePath}.`)
      }
      totalBytes += entry.bytes.byteLength
      if (entry.bytes.byteLength > (this.options.maxResourceBytes ?? DEFAULT_MAX_RESOURCE_BYTES)) {
        throw new PodArchiveError('pod_restore_resource_size', `Resource exceeds the restore size limit: ${entry.archivePath}.`)
      }
      if (totalBytes > (this.options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES)) {
        throw new PodArchiveError('pod_restore_total_size', 'Archive exceeds the restore size limit.')
      }

      const targetUrl = targetUrlForArchivePath(targetRoot, entry.archivePath)
      const controlResource = entry.kind === 'acl' || entry.kind === 'acp'
      if (controlResource && !this.options.applyControlResources) {
        warnings.push(`${entry.archivePath}: control resource skipped by policy.`)
        items.push({ archivePath: entry.archivePath, targetUrl, kind: entry.kind, action: 'skip', status: 'planned' })
        continue
      }

      const existing = await this.session.fetch(targetUrl, { method: 'HEAD', redirect: 'error' })
      const action = existing.ok ? 'update' : existing.status === 404 ? 'create' : 'conflict'
      if (action === 'conflict') {
        items.push({ archivePath: entry.archivePath, targetUrl, kind: entry.kind, action, status: 'failed', error: `HTTP ${existing.status}` })
        continue
      }
      if (action === 'update' && this.options.conflictPolicy === 'fail') {
        items.push({ archivePath: entry.archivePath, targetUrl, kind: entry.kind, action: 'conflict', status: 'failed', error: 'Target resource already exists.' })
        continue
      }
      if (action === 'update' && this.options.conflictPolicy === 'skip') {
        items.push({ archivePath: entry.archivePath, targetUrl, kind: entry.kind, action: 'skip', status: 'planned' })
        continue
      }
      if (action === 'update' && this.options.conflictPolicy === 'overwrite-if-unchanged') {
        const currentEtag = existing.headers.get('etag')
        if (!manifestResource.etag || !currentEtag || currentEtag !== manifestResource.etag) {
          items.push({ archivePath: entry.archivePath, targetUrl, kind: entry.kind, action: 'conflict', status: 'failed', error: 'Target ETag changed since export.' })
          continue
        }
      }

      const item: PodArchiveRestoreItem = { archivePath: entry.archivePath, targetUrl, kind: entry.kind, action, status: 'planned' }
      if (!dryRun) {
        if (entry.kind === 'container') {
          if (action === 'create') {
            const response = await this.session.fetch(targetUrl, {
              method: 'PUT',
              headers: {
                'content-type': 'text/turtle',
                link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
              },
              body: '',
              redirect: 'error',
            })
            if (!response.ok) {
              item.status = 'failed'
              item.action = 'failed'
              item.error = `HTTP ${response.status}`
            } else {
              item.status = 'applied'
            }
          } else {
            item.status = 'applied'
          }
        } else {
          const headers: Record<string, string> = { 'content-type': manifestResource.mediaType ?? 'application/octet-stream' }
          if (action === 'update' && this.options.conflictPolicy === 'overwrite-if-unchanged' && manifestResource.etag) {
            headers['if-match'] = manifestResource.etag
          }
          const body = entry.bytes.slice().buffer as ArrayBuffer
          const response = await this.session.fetch(targetUrl, { method: 'PUT', headers, body, redirect: 'error' })
          if (!response.ok) {
            item.status = 'failed'
            item.action = 'failed'
            item.error = `HTTP ${response.status}`
          } else {
            item.status = 'applied'
          }
        }
      }
      items.push(item)
      this.options.onProgress?.({ completed: items.length, discovered: entries.length, totalBytes, url: targetUrl, status: item.status === 'failed' ? 'failed' : 'exported' })
    }

    return { targetPodUrl: targetRoot, dryRun, items, warnings }
  }

  private throwIfAborted(): void {
    if (this.options.signal?.aborted) throw new PodArchiveError('pod_restore_cancelled', 'Pod restore was cancelled.')
  }
}

function validateManifest(manifest: PodArchiveManifest): void {
  if (manifest.format !== 'nodezero-solid-pod' || manifest.formatVersion !== 1) {
    throw new PodArchiveError('pod_restore_version', 'Pod archive format is not supported.')
  }
  canonicalizePodRoot(manifest.podUrl)
  const paths = new Set<string>()
  for (const resource of manifest.resources) {
    if (!resource.archivePath.startsWith('pod/')) throw new PodArchiveError('pod_restore_path', `Invalid archive path: ${resource.archivePath}.`)
    if (resource.archivePath.includes('..') || resource.archivePath.includes('\\')) {
      throw new PodArchiveError('pod_restore_path', `Invalid archive path: ${resource.archivePath}.`)
    }
    if (paths.has(resource.archivePath)) throw new PodArchiveError('pod_restore_duplicate_path', `Duplicate archive path: ${resource.archivePath}.`)
    paths.add(resource.archivePath)
    if (resource.status === 'exported') {
      const canonicalSource = canonicalizePodResource(manifest.podUrl, resource.sourceUrl)
      if (canonicalSource !== resource.sourceUrl) {
        throw new PodArchiveError('pod_restore_source_url', `Source URL is outside or not canonical: ${resource.sourceUrl}.`)
      }
    }
  }
}

function targetUrlForArchivePath(targetRoot: string, archivePath: string): string {
  if (!archivePath.startsWith('pod/')) throw new PodArchiveError('pod_restore_path', `Invalid archive path: ${archivePath}.`)
  const relative = archivePath.slice(4)
  const targetPath = relative.endsWith('/.container') ? relative.slice(0, -10) : relative
  const resourceUrl = targetPath ? new URL(targetPath, targetRoot).toString() : targetRoot
  return canonicalizePodResource(targetRoot, resourceUrl)
}

function sortRestoreEntries(entries: PodArchiveEntry[]): PodArchiveEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind === 'container' && right.kind !== 'container') return -1
    if (left.kind !== 'container' && right.kind === 'container') return 1
    return left.archivePath.localeCompare(right.archivePath)
  })
}