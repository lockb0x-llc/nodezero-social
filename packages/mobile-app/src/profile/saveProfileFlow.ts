import type {
  PrivateProfilePreferencesDocument,
  UserProfile,
} from '@nodezero/solid-pod-sync'
import {
  buildPrivatePreferencesPayload,
  buildUpdatedProfileDraft,
  interestsToInput,
  mergeProfileData,
} from './mergeProfileData'

export interface ProfileSaveDependencies {
  writePublicProfile(podRoot: string, profile: UserProfile): Promise<void>
  writePrivatePreferences(
    podRoot: string,
    preferences: PrivateProfilePreferencesDocument,
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
}

export function derivePodRootFromWebId(webId: string): string {
  return `${webId.split('/profile/')[0]}/`
}

export async function executeProfileSaveFlow(
  input: ExecuteProfileSaveFlowInput,
): Promise<ExecuteProfileSaveFlowResult> {
  const { ownerWebId, currentProfile, interestsInput, deps } = input
  const podRoot = derivePodRootFromWebId(ownerWebId)
  const updatedProfile = buildUpdatedProfileDraft(currentProfile, interestsInput)

  await deps.writePublicProfile(podRoot, updatedProfile)

  const preferencesPayload = buildPrivatePreferencesPayload(updatedProfile)
  await deps.writePrivatePreferences(podRoot, preferencesPayload)

  const [savedPublic, savedPrivate] = await Promise.all([
    deps.readPublicProfile(`${podRoot}profile/card#me`),
    deps.readPrivatePreferences(podRoot),
  ])

  const mergedSavedProfile = savedPublic ? mergeProfileData(savedPublic, savedPrivate) : null
  const mergedSavedInterestsInput = mergedSavedProfile
    ? interestsToInput(mergedSavedProfile.interests)
    : null

  return {
    podRoot,
    updatedProfile,
    preferencesPayload,
    mergedSavedProfile,
    mergedSavedInterestsInput,
  }
}
