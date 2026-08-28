import { unzipSync } from 'fflate'
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildPodArchiveZip } from './zipWriter.js'
import type { PodArchiveExportResult } from '@nodezero/solid-pod-sync'

void test('writes the manifest and exact resource bytes into a ZIP', () => {
  const result: PodArchiveExportResult = {
    manifest: {
      format: 'nodezero-solid-pod',
      formatVersion: 1,
      podUrl: 'https://alice.example/pod/',
      exportedAt: '2026-08-28T00:00:00.000Z',
      limits: { maxDepth: 1, maxResources: 2, maxResourceBytes: 10, maxTotalBytes: 20, concurrency: 1 },
      resources: [],
      warnings: [],
    },
    entries: [{
      sourceUrl: 'https://alice.example/pod/photo.bin',
      archivePath: 'pod/photo.bin',
      mediaType: 'application/octet-stream',
      etag: null,
      size: 3,
      kind: 'resource',
      status: 'exported',
      bytes: new Uint8Array([0, 255, 1]),
    }],
  }
  const files = unzipSync(buildPodArchiveZip(result))
  assert.deepEqual(JSON.parse(new TextDecoder().decode(files['manifest.json'])), result.manifest)
  assert.deepEqual([...files['pod/photo.bin']], [0, 255, 1])
})