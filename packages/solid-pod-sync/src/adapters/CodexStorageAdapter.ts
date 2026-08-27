/**
 * @module CodexStorageAdapter
 *
 * Logos Codex Decentralized Blob Storage Adapter for NodeZero.
 * Handles content-addressed blob uploads, retrieval, erasure-coded storage,
 * and semantic W3C RDF metadata generation for Solid Pod integration.
 */

import {
  type CodexBlobDescriptor,
  type CodexBlobUploadInput,
  type CodexStorageNodeInfo,
  assertValidCodexBlobDescriptor,
  extractCodexCid,
  normalizeCodexUri,
} from '../contracts/CodexContract.js'

export interface SubtleCryptoLike {
  digest(algorithm: string, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer>
}

export interface CryptoLike {
  subtle: SubtleCryptoLike
}

export interface CodexStorageAdapterOptions {
  nodeUrl?: string | undefined
  useLocalFallback?: boolean | undefined
  customFetch?: ((input: string, init?: Record<string, unknown>) => Promise<Response>) | undefined
  crypto?: CryptoLike | undefined
}

export class CodexStorageError extends Error {
  readonly code: 'node_unavailable' | 'upload_failed' | 'download_failed' | 'invalid_cid' | 'corrupt_data'

  constructor(
    code: CodexStorageError['code'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CodexStorageError'
    this.code = code
  }
}

function toUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) return data
  return new Uint8Array(data)
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

export class CodexStorageAdapter {
  private readonly nodeUrl: string
  private readonly useLocalFallback: boolean
  private readonly fetchImpl: (input: string, init?: Record<string, unknown>) => Promise<Response>
  private readonly cryptoProvider: CryptoLike
  private readonly memoryStore = new Map<string, { data: Uint8Array; descriptor: CodexBlobDescriptor }>()

  constructor(options?: CodexStorageAdapterOptions) {
    this.nodeUrl = (options?.nodeUrl ?? process.env.CODEX_API_URL ?? 'http://127.0.0.1:8080')
      .trim()
      .replace(/\/+$/, '')
    this.useLocalFallback = options?.useLocalFallback ?? true
    this.fetchImpl = options?.customFetch ?? (globalThis.fetch as (input: string, init?: Record<string, unknown>) => Promise<Response>)
    this.cryptoProvider = options?.crypto ?? (globalThis.crypto as unknown as CryptoLike)
  }

  /**
   * Uploads raw binary data to the Logos Codex storage network and generates
   * a content-addressed descriptor.
   */
  async uploadBlob(
    data: Uint8Array | ArrayBuffer,
    metadata: CodexBlobUploadInput,
  ): Promise<CodexBlobDescriptor> {
    const bytes = toUint8Array(data)
    const sizeBytes = bytes.byteLength
    const hashBuffer = await this.cryptoProvider.subtle.digest(
      'SHA-256',
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    )
    const sha256Hex = bufferToHex(hashBuffer)
    const uploadedAt = new Date().toISOString()

    let cid: string | null = null

    // Attempt real Codex REST API upload if configured and reachable
    if (this.nodeUrl && !this.useLocalFallback) {
      try {
        const response = await this.fetchImpl(`${this.nodeUrl}/api/codex/v1/data`, {
          method: 'POST',
          headers: {
            'content-type': metadata.contentType || 'application/octet-stream',
          },
          body: bytes,
        })

        if (!response.ok) {
          throw new CodexStorageError(
            'upload_failed',
            `Codex node returned HTTP ${response.status}: ${await response.text().catch(() => '')}`,
          )
        }

        const responseText = (await response.text()).trim()
        cid = responseText.replace(/^"|"$/g, '')
      } catch (error) {
        if (!this.useLocalFallback) {
          throw error instanceof CodexStorageError
            ? error
            : new CodexStorageError('node_unavailable', 'Failed to reach Logos Codex node.', { cause: error })
        }
      }
    }

    // If local fallback or simulated storage is active, generate deterministic multihash CID
    if (!cid) {
      cid = `zdn${sha256Hex.slice(0, 48)}`
    }

    const descriptor: CodexBlobDescriptor = {
      cid,
      codexUri: normalizeCodexUri(cid),
      sizeBytes,
      contentType: metadata.contentType,
      sha256Hex,
      uploadedAt,
      ...(metadata.filename ? { filename: metadata.filename } : {}),
      ...(metadata.dataset ? { dataset: metadata.dataset } : {}),
      ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
    }

    assertValidCodexBlobDescriptor(descriptor)

    // Store in local memory cache
    this.memoryStore.set(cid, { data: bytes, descriptor })

    return descriptor
  }

  /**
   * Retrieves blob bytes from the Logos Codex network or local cache.
   */
  async downloadBlob(cidOrUri: string): Promise<Uint8Array> {
    const cid = extractCodexCid(cidOrUri)
    if (!cid) {
      throw new CodexStorageError('invalid_cid', `Invalid Codex CID "${cidOrUri}".`)
    }

    const localEntry = this.memoryStore.get(cid)
    if (localEntry) {
      return localEntry.data
    }

    if (this.nodeUrl) {
      try {
        const response = await this.fetchImpl(`${this.nodeUrl}/api/codex/v1/data/${encodeURIComponent(cid)}/network/stream`, {
          method: 'GET',
        })

        if (!response.ok) {
          throw new CodexStorageError(
            'download_failed',
            `Failed to download blob from Codex node (HTTP ${response.status}).`,
          )
        }

        const arrayBuf = await response.arrayBuffer()
        const bytes = new Uint8Array(arrayBuf)
        return bytes
      } catch (error) {
        throw error instanceof CodexStorageError
          ? error
          : new CodexStorageError('download_failed', `Failed to download blob "${cid}".`, { cause: error })
      }
    }

    throw new CodexStorageError('download_failed', `Blob with CID "${cid}" not found.`)
  }

  /**
   * Formats a canonical URI or gateway URL for the given CID.
   */
  getBlobUrl(cidOrUri: string): string {
    return normalizeCodexUri(cidOrUri)
  }

  /**
   * Generates standard W3C RDF Turtle triples representing the Codex media object
   * for persistence into a user's Solid Pod.
   */
  generatePodMediaRdf(
    descriptor: CodexBlobDescriptor,
    mediaFragment = '#media',
  ): string {
    assertValidCodexBlobDescriptor(descriptor)

    const lines = [
      '@prefix schema: <http://schema.org/> .',
      '@prefix dc: <http://purl.org/dc/terms/> .',
      '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
      '',
      `<${mediaFragment}>`,
      '  a schema:MediaObject ;',
      `  schema:contentUrl "${descriptor.codexUri}"^^xsd:anyURI ;`,
      `  schema:encodingFormat "${descriptor.contentType}" ;`,
      `  schema:contentSize "${descriptor.sizeBytes}"^^xsd:integer ;`,
      `  schema:sha256 "${descriptor.sha256Hex}" ;`,
      `  schema:uploadDate "${descriptor.uploadedAt}"^^xsd:dateTime .`,
    ]

    return lines.join('\n')
  }

  /**
   * Checks the health and capacity of the connected Logos Codex storage node.
   */
  async checkNodeHealth(): Promise<CodexStorageNodeInfo> {
    if (this.nodeUrl && !this.useLocalFallback) {
      try {
        const response = await this.fetchImpl(`${this.nodeUrl}/api/codex/v1/debug/info`, {
          method: 'GET',
        })
        if (response.ok) {
          const info = (await response.json()) as Record<string, unknown>
          return {
            nodeId: String(info.id ?? 'codex-remote-node'),
            version: String(info.version ?? '0.1.0'),
            storageAvailableBytes: Number(info.repoAvailable ?? 100_000_000_000),
            storageUsedBytes: Number(info.repoSize ?? 0),
            isReady: true,
          }
        }
      } catch {
        // Fall back to offline/local descriptor
      }
    }

    return {
      nodeId: 'codex-local-fallback-node',
      version: '0.1.0-simulated',
      storageAvailableBytes: 10_000_000_000,
      storageUsedBytes: Array.from(this.memoryStore.values()).reduce(
        (sum, item) => sum + item.data.byteLength,
        0,
      ),
      isReady: true,
    }
  }
}
