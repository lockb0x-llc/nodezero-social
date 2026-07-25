import type { UserProfile } from '@nodezero/solid-pod-sync'

export const PROFILE_LIMITS = {
  displayNameMaxLength: 80,
  bioMaxLength: 280,
  maxInterests: 20,
  interestMaxLength: 40,
} as const

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function getProfileSaveValidationMessage(profile: UserProfile): string | null {
  if (profile.displayName.length > PROFILE_LIMITS.displayNameMaxLength) {
    return `Display name must be ${PROFILE_LIMITS.displayNameMaxLength} characters or fewer.`
  }

  if (profile.bio.length > PROFILE_LIMITS.bioMaxLength) {
    return `Bio must be ${PROFILE_LIMITS.bioMaxLength} characters or fewer.`
  }

  if (profile.interests.length > PROFILE_LIMITS.maxInterests) {
    return `You can add up to ${PROFILE_LIMITS.maxInterests} interests.`
  }

  for (const interest of profile.interests) {
    if (interest.length > PROFILE_LIMITS.interestMaxLength) {
      return `Each interest must be ${PROFILE_LIMITS.interestMaxLength} characters or fewer.`
    }
  }

  if (profile.avatarUrl && !isValidHttpUrl(profile.avatarUrl)) {
    return 'Avatar URL must be an absolute http(s) URL.'
  }

  if (profile.externalUrl && !isValidHttpUrl(profile.externalUrl)) {
    return 'External URL must be an absolute http(s) URL.'
  }

  return null
}

export function validateProfileForSave(profile: UserProfile): void {
  const message = getProfileSaveValidationMessage(profile)
  if (message) {
    throw new Error(message)
  }
}
