import type {
  PrivateProfilePreferencesDocument,
  UserProfile,
} from '@nodezero/solid-pod-sync'

export function mergeProfileData(
  publicProfile: UserProfile,
  privatePreferences: PrivateProfilePreferencesDocument | null,
): UserProfile {
  return {
    ...publicProfile,
    interests: privatePreferences?.interests ?? [],
    isNsfw: privatePreferences?.isNsfw ?? false,
  }
}

export function interestsToInput(interests: string[]): string {
  return interests.join(', ')
}
