/**
 * Social Graph v1 contract for stable connection identifiers.
 */

export interface ConnectionRecord {
  webId: string
}

export interface ContractValidationIssue {
  field: string
  message: string
}

function isValidWebId(value: string): boolean {
  try {
    const parsed = new URL(value)
    if (!(parsed.protocol === 'http:' || parsed.protocol === 'https:')) return false
    return parsed.hash.length > 1
  } catch {
    return false
  }
}

export function validateConnectionRecord(connection: ConnectionRecord): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = []
  if (!connection.webId?.trim()) {
    issues.push({ field: 'webId', message: 'webId is required' })
  } else if (!isValidWebId(connection.webId)) {
    issues.push({ field: 'webId', message: 'webId must be an absolute http(s) URL with a fragment identifier' })
  }
  return issues
}

export function assertValidConnectionRecord(connection: ConnectionRecord): void {
  const issues = validateConnectionRecord(connection)
  if (issues.length === 0) return

  const details = issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')
  throw new Error(`Social Graph contract validation failed: ${details}`)
}
