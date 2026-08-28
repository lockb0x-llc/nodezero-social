import { zipSync } from 'fflate'

interface PodArchiveZipInput {
  manifest: object
  entries: Array<{ archivePath: string; bytes: Uint8Array }>
}

export function buildPodArchiveZip(result: PodArchiveZipInput): Uint8Array {
  const paths = new Set<string>()
  const files: Record<string, Uint8Array> = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(result.manifest, null, 2)),
  }
  for (const entry of result.entries) {
    if (!entry.archivePath.startsWith('pod/') || entry.archivePath.includes('..') || entry.archivePath.includes('\\')) {
      throw new Error(`Unsafe Pod archive path: ${entry.archivePath}`)
    }
    if (paths.has(entry.archivePath)) throw new Error(`Duplicate Pod archive path: ${entry.archivePath}`)
    paths.add(entry.archivePath)
    files[entry.archivePath] = entry.bytes
  }
  return zipSync(files, { level: 6 }) as Uint8Array
}