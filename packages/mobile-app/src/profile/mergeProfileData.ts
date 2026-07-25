import type {
  PrivateProfilePreferencesDocument,
  UserProfile,
} from '@nodezero/solid-pod-sync'
import { deriveProfileNsfwFlag } from '../content/nsfwDecision'

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

export function parseInterestsInput(input: string): string[] {
  return input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function buildUpdatedProfileDraft(profile: UserProfile, interestsInput: string): UserProfile {
  return {
    ...profile,
    interests: parseInterestsInput(interestsInput),
  }
}

export function buildPrivatePreferencesPayload(
  updatedProfile: UserProfile,
): PrivateProfilePreferencesDocument {
  return {
    interests: updatedProfile.interests,
    isNsfw: deriveProfileNsfwFlag(updatedProfile, updatedProfile.isNsfw),
  }
}
