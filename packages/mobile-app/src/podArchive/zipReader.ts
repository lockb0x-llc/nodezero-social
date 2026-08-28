import { unzipSync } from 'fflate'
import { canonicalizePodResource, canonicalizePodRoot } from '@nodezero/solid-pod-sync'
import type { PodArchiveEntry, PodArchiveManifest } from '@nodezero/solid-pod-sync'

export interface PodArchiveContents {
  manifest: PodArchiveManifest
  entries: PodArchiveEntry[]
}

export function readPodArchiveZip(bytes: Uint8Array): PodArchiveContents {
  const files = unzipSync(bytes) as Record<string, Uint8Array>
  const manifestBytes = files['manifest.json']
  if (!manifestBytes) throw new Error('Pod archive is missing manifest.json.')

  let manifest: PodArchiveManifest
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as PodArchiveManifest
  } catch {
    throw new Error('Pod archive manifest is not valid JSON.')
  }
  if (manifest.format !== 'nodezero-solid-pod' || manifest.formatVersion !== 1) {
    throw new Error('Pod archive format is not supported.')
  }
  if (!Array.isArray(manifest.resources) || manifest.resources.length > 10_000) {
    throw new Error('Pod archive manifest has an invalid resource list.')
  }
  const sourceRoot = canonicalizePodRoot(manifest.podUrl)
  const paths = new Set<string>()
  const expectedPaths = new Set<string>(['manifest.json'])
  for (const resource of manifest.resources) {
    if (!resource.archivePath.startsWith('pod/') || resource.archivePath.includes('..') || resource.archivePath.includes('\\')) {
      throw new Error(`Pod archive contains an unsafe path: ${resource.archivePath}`)
    }
    if (paths.has(resource.archivePath)) throw new Error(`Pod archive contains a duplicate path: ${resource.archivePath}`)
    paths.add(resource.archivePath)
    expectedPaths.add(resource.archivePath)
    if (resource.status === 'exported') {
      if (canonicalizePodResource(sourceRoot, resource.sourceUrl) !== resource.sourceUrl) {
        throw new Error(`Pod archive contains an out-of-namespace source URL: ${resource.sourceUrl}`)
      }
      if (!Number.isSafeInteger(resource.size) || resource.size < 0) {
        throw new Error(`Pod archive contains an invalid resource size: ${resource.archivePath}`)
      }
    }
  }

  const entries: PodArchiveEntry[] = []
  let totalBytes = 0
  for (const resource of manifest.resources) {
    if (resource.status !== 'exported') continue
    const resourceBytes = files[resource.archivePath]
    if (!resourceBytes) throw new Error(`Pod archive is missing ${resource.archivePath}.`)
    if (resourceBytes.byteLength !== resource.size) throw new Error(`Pod archive size mismatch for ${resource.archivePath}.`)
    totalBytes += resourceBytes.byteLength
    if (totalBytes > manifest.limits.maxTotalBytes) throw new Error('Pod archive exceeds its declared total size limit.')
    entries.push({ ...resource, bytes: resourceBytes })
  }
  for (const path of Object.keys(files)) {
    if (!expectedPaths.has(path)) throw new Error(`Pod archive contains an unexpected file: ${path}.`)
  }
  return { manifest, entries }
}