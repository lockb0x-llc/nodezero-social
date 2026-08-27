import {
  CODEX_URI_PREFIX,
  isValidCodexCid,
  normalizeCodexUri,
  extractCodexCid,
  validateCodexBlobDescriptor,
  assertValidCodexBlobDescriptor,
  type CodexBlobDescriptor,
} from '../contracts/CodexContract.js'
import {
  CodexStorageAdapter,
  CodexStorageError,
} from '../adapters/CodexStorageAdapter.js'

describe('Logos Codex Decentralized Blob Storage Adapter', () => {
  describe('CodexContract & CID Utilities', () => {
    it('validates and normalizes Codex CIDs and URIs', () => {
      const cid = 'zdn675cqlxbydgnr2vcspotestnetcbfwy2zf73n5sdh4pqfpr7e5sh'
      expect(isValidCodexCid(cid)).toBe(true)
      expect(isValidCodexCid(`codex://${cid}`)).toBe(true)
      expect(isValidCodexCid('invalid-cid')).toBe(false)

      expect(normalizeCodexUri(cid)).toBe(`codex://${cid}`)
      expect(normalizeCodexUri(`codex://${cid}`)).toBe(`codex://${cid}`)

      expect(extractCodexCid(`codex://${cid}`)).toBe(cid)
      expect(extractCodexCid(cid)).toBe(cid)
    })

    it('validates CodexBlobDescriptor structure and catches missing fields', () => {
      const validDescriptor: CodexBlobDescriptor = {
        cid: 'zdn675cqlxbydgnr2vcspotestnetcbfwy2zf73n5sdh4pqfpr7e5sh',
        codexUri: 'codex://zdn675cqlxbydgnr2vcspotestnetcbfwy2zf73n5sdh4pqfpr7e5sh',
        sizeBytes: 1048576,
        contentType: 'video/mp4',
        sha256Hex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        uploadedAt: '2026-08-27T12:00:00.000Z',
        filename: 'recording.mp4',
      }

      expect(validateCodexBlobDescriptor(validDescriptor)).toHaveLength(0)
      expect(() => assertValidCodexBlobDescriptor(validDescriptor)).not.toThrow()

      const invalidDescriptor = { ...validDescriptor, cid: 'bad-cid', sizeBytes: -10 }
      const issues = validateCodexBlobDescriptor(invalidDescriptor)
      expect(issues.length).toBeGreaterThan(0)
      expect(() => assertValidCodexBlobDescriptor(invalidDescriptor)).toThrow()
    })
  })

  describe('CodexStorageAdapter Operations', () => {
    it('uploads a blob and retrieves its binary content in local fallback mode', async () => {
      const adapter = new CodexStorageAdapter({ useLocalFallback: true })
      const sampleData = new TextEncoder().encode('Hello, Logos Codex decentralized blob store!')

      const descriptor = await adapter.uploadBlob(sampleData, {
        contentType: 'text/plain',
        filename: 'hello.txt',
      })

      expect(descriptor.cid.startsWith('zdn')).toBe(true)
      expect(descriptor.codexUri.startsWith(CODEX_URI_PREFIX)).toBe(true)
      expect(descriptor.sizeBytes).toBe(sampleData.byteLength)
      expect(descriptor.contentType).toBe('text/plain')
      expect(descriptor.filename).toBe('hello.txt')
      expect(descriptor.sha256Hex).toHaveLength(64)

      const downloaded = await adapter.downloadBlob(descriptor.cid)
      expect(new TextDecoder().decode(downloaded)).toBe('Hello, Logos Codex decentralized blob store!')

      const downloadedByUri = await adapter.downloadBlob(descriptor.codexUri)
      expect(new TextDecoder().decode(downloadedByUri)).toBe('Hello, Logos Codex decentralized blob store!')
    })

    it('generates schema-compliant W3C RDF Turtle media metadata for Solid Pods', async () => {
      const adapter = new CodexStorageAdapter({ useLocalFallback: true })
      const sampleData = new Uint8Array([0x00, 0x01, 0x02, 0x03])

      const descriptor = await adapter.uploadBlob(sampleData, {
        contentType: 'application/octet-stream',
        filename: 'artifact.bin',
      })

      const turtleRdf = adapter.generatePodMediaRdf(descriptor, '#media-artifact')
      expect(turtleRdf).toContain('<#media-artifact>')
      expect(turtleRdf).toContain('a schema:MediaObject ;')
      expect(turtleRdf).toContain(`schema:contentUrl "${descriptor.codexUri}"^^xsd:anyURI ;`)
      expect(turtleRdf).toContain('schema:encodingFormat "application/octet-stream" ;')
      expect(turtleRdf).toContain(`schema:contentSize "${descriptor.sizeBytes}"^^xsd:integer ;`)
      expect(turtleRdf).toContain(`schema:sha256 "${descriptor.sha256Hex}" ;`)
    })

    it('throws CodexStorageError when downloading an unknown CID', async () => {
      const adapter = new CodexStorageAdapter({ useLocalFallback: true })
      await expect(
        adapter.downloadBlob('zdn00000000000000000000000000000000000000000000000000'),
      ).rejects.toThrow(CodexStorageError)
    })

    it('interacts with a remote Codex REST endpoint when customFetch is provided', async () => {
      const mockCid = 'zdnremote1234567890abcdef1234567890abcdef12345678'
      const sampleBytes = new TextEncoder().encode('Remote blob stream')

      const mockFetch = async (input: string, init?: Record<string, unknown>): Promise<Response> => {
        const url = String(input)
        if (url.endsWith('/api/codex/v1/data') && init?.method === 'POST') {
          return new Response(JSON.stringify(mockCid), { status: 200 })
        }
        if (url.includes(`/api/codex/v1/data/${mockCid}/network/stream`)) {
          return new Response(sampleBytes, { status: 200 })
        }
        if (url.endsWith('/api/codex/v1/debug/info')) {
          return new Response(
            JSON.stringify({
              id: 'codex-remote-test-node',
              version: '0.1.0',
              repoAvailable: 50_000_000_000,
              repoSize: 10_000_000,
            }),
            { status: 200 },
          )
        }
        return new Response('Not found', { status: 404 })
      }

      const remoteAdapter = new CodexStorageAdapter({
        nodeUrl: 'http://127.0.0.1:8080',
        useLocalFallback: false,
        customFetch: mockFetch,
      })

      const descriptor = await remoteAdapter.uploadBlob(sampleBytes, {
        contentType: 'text/plain',
      })
      expect(descriptor.cid).toBe(mockCid)

      const downloaded = await remoteAdapter.downloadBlob(mockCid)
      expect(new TextDecoder().decode(downloaded)).toBe('Remote blob stream')

      const health = await remoteAdapter.checkNodeHealth()
      expect(health.isReady).toBe(true)
      expect(health.nodeId).toBe('codex-remote-test-node')
    })
  })
})
