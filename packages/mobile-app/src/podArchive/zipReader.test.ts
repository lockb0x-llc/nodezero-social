import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { zipSync } from 'fflate'
import { buildPodArchiveZip } from './zipWriter.js'
import { readPodArchiveZip } from './zipReader.js'

void test('reads a Pod archive manifest and its resource bytes', () => {
  const source = {
    manifest: {
      format: 'nodezero-solid-pod' as const,
      formatVersion: 1 as const,
      podUrl: 'https://alice.example/pod/',
      exportedAt: '2026-08-28T00:00:00.000Z',
      limits: { maxDepth: 1, maxResources: 1, maxResourceBytes: 10, maxTotalBytes: 10, concurrency: 1 },
      resources: [{
        sourceUrl: 'https://alice.example/pod/note.txt',
        archivePath: 'pod/note.txt',
        mediaType: 'text/plain',
        etag: null,
        size: 3,
        kind: 'resource' as const,
        status: 'exported' as const,
      }],
      warnings: [],
    },
    entries: [{
      sourceUrl: 'https://alice.example/pod/note.txt',
      archivePath: 'pod/note.txt',
      mediaType: 'text/plain',
      etag: null,
      size: 3,
      kind: 'resource' as const,
      status: 'exported' as const,
      bytes: new Uint8Array([1, 2, 3]),
    }],
  }
  const contents = readPodArchiveZip(buildPodArchiveZip(source))
  assert.equal(contents.manifest.formatVersion, 1)
  assert.deepEqual([...contents.entries[0].bytes], [1, 2, 3])
})

void test('rejects unexpected ZIP files and manifest size mismatches', () => {
  const manifest = {
    format: 'nodezero-solid-pod',
    formatVersion: 1,
    podUrl: 'https://alice.example/pod/',
    exportedAt: '2026-08-28T00:00:00.000Z',
    limits: { maxDepth: 1, maxResources: 1, maxResourceBytes: 10, maxTotalBytes: 10, concurrency: 1 },
    resources: [{
      sourceUrl: 'https://alice.example/pod/note.txt',
      archivePath: 'pod/note.txt',
      mediaType: 'text/plain',
      etag: null,
      size: 4,
      kind: 'resource',
      status: 'exported',
    }],
    warnings: [],
  }
  const bytes = zipSync({
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'pod/note.txt': new Uint8Array([1, 2, 3]),
    'pod/unlisted.txt': new Uint8Array([4]),
  }) as Uint8Array
  assert.throws(() => readPodArchiveZip(bytes), /size mismatch/)
})