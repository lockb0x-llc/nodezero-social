import type { UserProfile } from '@nodezero/solid-pod-sync'

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function validateProfileForSave(profile: UserProfile): void {
  if (profile.avatarUrl && !isValidHttpUrl(profile.avatarUrl)) {
    throw new Error('Avatar URL must be an absolute http(s) URL.')
  }

  if (profile.externalUrl && !isValidHttpUrl(profile.externalUrl)) {
    throw new Error('External URL must be an absolute http(s) URL.')
  }
}
