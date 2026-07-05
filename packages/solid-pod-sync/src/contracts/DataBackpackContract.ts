/**
 * Data Backpack v1 contract for profile-centric portable user data.
 */

export interface DataBackpackProfile {
  displayName: string
  bio: string
  avatarUrl?: string
  externalUrl?: string
  interests: string[]
  isNsfw: boolean
}

export interface ContractValidationIssue {
  field: string
  message: string
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function validateDataBackpackProfile(profile: DataBackpackProfile): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = []

  if (!profile.displayName?.trim()) {
    issues.push({ field: 'displayName', message: 'displayName is required' })
  }

  if (!Array.isArray(profile.interests)) {
    issues.push({ field: 'interests', message: 'interests must be an array' })
  } else {
    const hasBlankInterest = profile.interests.some((interest) => !interest?.trim())
    if (hasBlankInterest) {
      issues.push({ field: 'interests', message: 'interests cannot include blank values' })
    }
  }

  if (typeof profile.isNsfw !== 'boolean') {
    issues.push({ field: 'isNsfw', message: 'isNsfw must be a boolean' })
  }

  if (profile.avatarUrl !== undefined && profile.avatarUrl.length > 0 && !isHttpUrl(profile.avatarUrl)) {
    issues.push({ field: 'avatarUrl', message: 'avatarUrl must be an absolute http(s) URL when provided' })
  }

  if (profile.externalUrl !== undefined && profile.externalUrl.length > 0 && !isHttpUrl(profile.externalUrl)) {
    issues.push({ field: 'externalUrl', message: 'externalUrl must be an absolute http(s) URL when provided' })
  }

  return issues
}

export function assertValidDataBackpackProfile(profile: DataBackpackProfile): void {
  const issues = validateDataBackpackProfile(profile)
  if (issues.length === 0) return

  const details = issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')
  throw new Error(`Data Backpack contract validation failed: ${details}`)
}
