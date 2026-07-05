export const DOCUSTREAM_SOURCE_TYPES = ['rss'] as const

export type DocustreamSourceType = (typeof DOCUSTREAM_SOURCE_TYPES)[number]

export interface DocustreamSource {
  id: string
  type: DocustreamSourceType
  url: string
  title?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastIngestedAt?: string
  lastError?: string
}

export interface SourceValidationIssue {
  field: keyof DocustreamSource
  message: string
}

function isIsoTimestamp(value: string): boolean {
  if (!value || Number.isNaN(Date.parse(value))) return false
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)
}

function isSafeSourceId(value: string): boolean {
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

export function validateDocustreamSource(source: DocustreamSource): SourceValidationIssue[] {
  const issues: SourceValidationIssue[] = []

  if (!source.id?.trim()) {
    issues.push({ field: 'id', message: 'id is required' })
  } else if (!isSafeSourceId(source.id)) {
    issues.push({
      field: 'id',
      message: 'id may only contain letters, numbers, dash, underscore, and dot',
    })
  }

  if (!DOCUSTREAM_SOURCE_TYPES.includes(source.type)) {
    issues.push({ field: 'type', message: `type must be one of: ${DOCUSTREAM_SOURCE_TYPES.join(', ')}` })
  }

  if (!isHttpUrl(source.url)) {
    issues.push({ field: 'url', message: 'url must be an absolute http(s) URL' })
  }

  if (!isIsoTimestamp(source.createdAt)) {
    issues.push({ field: 'createdAt', message: 'createdAt must be an ISO-8601 UTC string' })
  }

  if (!isIsoTimestamp(source.updatedAt)) {
    issues.push({ field: 'updatedAt', message: 'updatedAt must be an ISO-8601 UTC string' })
  }

  if (source.lastIngestedAt !== undefined && source.lastIngestedAt.length > 0 && !isIsoTimestamp(source.lastIngestedAt)) {
    issues.push({ field: 'lastIngestedAt', message: 'lastIngestedAt must be an ISO-8601 UTC string when provided' })
  }

  if (source.lastError !== undefined && source.lastError.length > 512) {
    issues.push({ field: 'lastError', message: 'lastError must be <= 512 chars' })
  }

  return issues
}

export function assertValidDocustreamSource(source: DocustreamSource): void {
  const issues = validateDocustreamSource(source)
  if (issues.length === 0) return

  const details = issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')
  throw new Error(`DocuStream source validation failed: ${details}`)
}
