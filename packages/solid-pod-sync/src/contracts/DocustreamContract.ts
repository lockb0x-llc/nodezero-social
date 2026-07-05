/**
 * DocuStream v1 domain contract.
 *
 * This module provides a single, reusable shape and validator for stream items.
 * Keeping this contract independent from adapter logic supports Layer 1 (contract-first)
 * implementation without coupling to transport or UI concerns.
 */

export const DOCUSTREAM_ALLOWED_SOURCES = ['reddit', 'x', 'nodezero', 'rss'] as const

export type StreamSource = (typeof DOCUSTREAM_ALLOWED_SOURCES)[number]

/** Core event shape persisted to Pod-backed DocuStream resources. */
export interface StreamItem {
  id: string
  source: StreamSource
  author: string
  title?: string
  content: string
  timestamp: string
  url?: string
}

/** Validation issue emitted when a field violates the contract. */
export interface ContractValidationIssue {
  field: keyof StreamItem
  message: string
}

function isValidIsoTimestamp(value: string): boolean {
  if (!value || Number.isNaN(Date.parse(value))) return false
  // Require normalized UTC timestamps to keep ordering deterministic.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)
}

function isSafeResourceId(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value)
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Validates a stream item against the DocuStream v1 contract.
 * Returns all issues rather than failing fast so callers can provide actionable errors.
 */
export function validateStreamItem(item: StreamItem): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = []

  if (!item.id?.trim()) {
    issues.push({ field: 'id', message: 'id is required' })
  } else if (!isSafeResourceId(item.id)) {
    issues.push({
      field: 'id',
      message: 'id may only contain letters, numbers, dash, underscore, and dot',
    })
  }

  if (!DOCUSTREAM_ALLOWED_SOURCES.includes(item.source)) {
    issues.push({ field: 'source', message: `source must be one of: ${DOCUSTREAM_ALLOWED_SOURCES.join(', ')}` })
  }

  if (!item.author?.trim()) {
    issues.push({ field: 'author', message: 'author is required' })
  }

  if (!item.content?.trim()) {
    issues.push({ field: 'content', message: 'content is required' })
  }

  if (!isValidIsoTimestamp(item.timestamp)) {
    issues.push({ field: 'timestamp', message: 'timestamp must be an ISO-8601 UTC string' })
  }

  if (item.url !== undefined && item.url.trim().length > 0 && !isHttpUrl(item.url)) {
    issues.push({ field: 'url', message: 'url must be an absolute http(s) URL when provided' })
  }

  return issues
}

/** Throws if a stream item is invalid. */
export function assertValidStreamItem(item: StreamItem): void {
  const issues = validateStreamItem(item)
  if (issues.length === 0) return

  const details = issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')
  throw new Error(`DocuStream contract validation failed: ${details}`)
}
