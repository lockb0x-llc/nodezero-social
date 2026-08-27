/**
 * @module CodexContract
 *
 * Data models, schemas, and validators for the Logos Codex decentralized
 * blob storage tier and its W3C RDF semantic representation in Solid Pods.
 */

export const CODEX_URI_PREFIX = 'codex://'
export const CODEX_CID_REGEX = /^(?:codex:\/\/)?(zdn[0-9a-zA-Z]+|[a-f0-9]{64}|z[1-9A-HJ-NP-Za-km-z]+)$/

export interface CodexBlobUploadInput {
  filename?: string | undefined
  contentType: string
  dataset?: string | undefined
  durationMs?: number | undefined
  pin?: boolean | undefined
}

export interface CodexBlobDescriptor {
  cid: string
  codexUri: string
  sizeBytes: number
  contentType: string
  sha256Hex: string
  uploadedAt: string
  filename?: string | undefined
  dataset?: string | undefined
  durationMs?: number | undefined
}

export interface CodexStorageNodeInfo {
  nodeId: string
  version: string
  storageAvailableBytes: number
  storageUsedBytes: number
  isReady: boolean
}

export interface CodexStorageValidationIssue {
  field: string
  message: string
}

export function isValidCodexCid(cid: string): boolean {
  if (typeof cid !== 'string' || !cid.trim()) return false
  return CODEX_CID_REGEX.test(cid.trim())
}

export function normalizeCodexUri(cidOrUri: string): string {
  const clean = cidOrUri.trim()
  if (clean.startsWith(CODEX_URI_PREFIX)) {
    return clean
  }
  return `${CODEX_URI_PREFIX}${clean}`
}

export function extractCodexCid(cidOrUri: string): string {
  const clean = cidOrUri.trim()
  if (clean.startsWith(CODEX_URI_PREFIX)) {
    return clean.slice(CODEX_URI_PREFIX.length)
  }
  return clean
}

export function validateCodexBlobDescriptor(
  descriptor: unknown,
): CodexStorageValidationIssue[] {
  const issues: CodexStorageValidationIssue[] = []
  if (!descriptor || typeof descriptor !== 'object') {
    return [{ field: 'descriptor', message: 'Descriptor must be an object' }]
  }

  const d = descriptor as Partial<CodexBlobDescriptor>

  if (!d.cid || typeof d.cid !== 'string' || !isValidCodexCid(d.cid)) {
    issues.push({ field: 'cid', message: 'Valid Codex CID is required.' })
  }

  if (
    !d.codexUri ||
    typeof d.codexUri !== 'string' ||
    !d.codexUri.startsWith(CODEX_URI_PREFIX)
  ) {
    issues.push({
      field: 'codexUri',
      message: `codexUri must start with "${CODEX_URI_PREFIX}".`,
    })
  }

  if (typeof d.sizeBytes !== 'number' || d.sizeBytes < 0) {
    issues.push({
      field: 'sizeBytes',
      message: 'sizeBytes must be a non-negative integer.',
    })
  }

  if (!d.contentType || typeof d.contentType !== 'string') {
    issues.push({
      field: 'contentType',
      message: 'contentType is required.',
    })
  }

  if (
    !d.sha256Hex ||
    typeof d.sha256Hex !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(d.sha256Hex)
  ) {
    issues.push({
      field: 'sha256Hex',
      message: 'sha256Hex must be a 64-character hexadecimal string.',
    })
  }

  if (!d.uploadedAt || isNaN(Date.parse(d.uploadedAt))) {
    issues.push({
      field: 'uploadedAt',
      message: 'uploadedAt must be a valid ISO 8601 date string.',
    })
  }

  return issues
}

export function assertValidCodexBlobDescriptor(descriptor: unknown): void {
  const issues = validateCodexBlobDescriptor(descriptor)
  if (issues.length > 0) {
    throw new Error(
      `Invalid CodexBlobDescriptor: ${issues
        .map((i) => `${i.field}: ${i.message}`)
        .join(', ')}`,
    )
  }
}
