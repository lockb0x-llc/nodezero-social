import type { PrivateProfilePreferencesDocument, UserProfile } from '@nodezero/solid-pod-sync'
import {
  buildPrivatePreferencesPayload,
  buildUpdatedProfileDraft,
  interestsToInput,
  mergeProfileData,
} from './mergeProfileData'
import { validateProfileForSave } from './profileValidation'

export interface ProfileSaveDependencies {
  writePublicProfile(podRoot: string, profile: UserProfile): Promise<void>
  writePrivatePreferences(
    podRoot: string,
    preferences: PrivateProfilePreferencesDocument
  ): Promise<void>
  readPublicProfile(webId: string): Promise<UserProfile | null>
  readPrivatePreferences(podRoot: string): Promise<PrivateProfilePreferencesDocument | null>
}

export interface ExecuteProfileSaveFlowInput {
  ownerWebId: string
  currentProfile: UserProfile
  interestsInput: string
  deps: ProfileSaveDependencies
}

export interface ExecuteProfileSaveFlowResult {
  podRoot: string
  updatedProfile: UserProfile
  preferencesPayload: PrivateProfilePreferencesDocument
  mergedSavedProfile: UserProfile | null
  mergedSavedInterestsInput: string | null
  privatePreferencesSaved: boolean
}

export function derivePodRootFromWebId(webId: string): string {
  return `${webId.split('/profile/')[0]}/`
}

export async function executeProfileSaveFlow(
  input: ExecuteProfileSaveFlowInput
): Promise<ExecuteProfileSaveFlowResult> {
  const { ownerWebId, currentProfile, interestsInput, deps } = input
  const podRoot = derivePodRootFromWebId(ownerWebId)
  const updatedProfile = buildUpdatedProfileDraft(currentProfile, interestsInput)
  validateProfileForSave(updatedProfile)

  await deps.writePublicProfile(podRoot, updatedProfile)

  const preferencesPayload = buildPrivatePreferencesPayload(updatedProfile)
  let privatePreferencesSaved = true
  try {
    await deps.writePrivatePreferences(podRoot, preferencesPayload)
  } catch {
    // Public profile data is the primary profile record. Preference storage
    // provisions optional Backpack containers and must not make a completed
    // profile-card write appear to fail.
    privatePreferencesSaved = false
  }

  const mergedSavedProfile = mergeProfileData(
    updatedProfile,
    privatePreferencesSaved ? preferencesPayload : null
  )
  const mergedSavedInterestsInput = interestsToInput(mergedSavedProfile.interests)

  return {
    podRoot,
    updatedProfile,
    preferencesPayload,
    mergedSavedProfile,
    mergedSavedInterestsInput,
    privatePreferencesSaved,
  }
}
