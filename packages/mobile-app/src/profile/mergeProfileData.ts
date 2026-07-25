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
  const deduped = new Set<string>()

  for (const value of input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)) {
    deduped.add(value)
  }

  return Array.from(deduped)
}

function normalizeOptionalField(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function buildUpdatedProfileDraft(profile: UserProfile, interestsInput: string): UserProfile {
  return {
    ...profile,
    displayName: profile.displayName.trim(),
    bio: profile.bio.trim(),
    avatarUrl: normalizeOptionalField(profile.avatarUrl),
    externalUrl: normalizeOptionalField(profile.externalUrl),
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
