import { zipSync } from 'fflate'
import type { PodArchiveExportResult } from '@nodezero/solid-pod-sync'

export function buildPodArchiveZip(result: PodArchiveExportResult): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(result.manifest, null, 2)),
  }
  for (const entry of result.entries) {
    files[entry.archivePath] = entry.bytes
  }
  return zipSync(files, { level: 6 })
}