import { zipSync } from 'fflate'

interface PodArchiveZipInput {
  manifest: object
  entries: Array<{ archivePath: string; bytes: Uint8Array }>
}

export function buildPodArchiveZip(result: PodArchiveZipInput): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(result.manifest, null, 2)),
  }
  for (const entry of result.entries) {
    files[entry.archivePath] = entry.bytes
  }
  return zipSync(files, { level: 6 }) as Uint8Array
}