import { unzipSync } from 'fflate'
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

  const entries: PodArchiveEntry[] = []
  for (const resource of manifest.resources) {
    if (resource.status !== 'exported') continue
    const resourceBytes = files[resource.archivePath]
    if (!resourceBytes) throw new Error(`Pod archive is missing ${resource.archivePath}.`)
    entries.push({ ...resource, bytes: resourceBytes })
  }
  return { manifest, entries }
}