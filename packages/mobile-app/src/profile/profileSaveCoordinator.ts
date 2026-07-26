import type { UserProfile } from '@nodezero/solid-pod-sync'
import {
  executeProfileSaveFlow,
  type ProfileSaveDependencies,
} from './saveProfileFlow'

export type ProfileSaveOutcome =
  | {
      status: 'read-only'
      message: string
    }
  | {
      status: 'no-op'
      message: string
    }
  | {
      status: 'saved'
      message: string
      mergedSavedProfile: UserProfile | null
      mergedSavedInterestsInput: string | null
    }
  | {
      status: 'error'
      message: string
      error: unknown
    }

export async function saveProfileForScreen(args: {
  isPeerView: boolean
  ownerWebId: string | null
  currentProfile: UserProfile
  interestsInput: string
  deps: ProfileSaveDependencies
}): Promise<ProfileSaveOutcome> {
  const { isPeerView, ownerWebId, currentProfile, interestsInput, deps } = args

  if (isPeerView) {
    return {
      status: 'read-only',
      message: 'You can only edit your own profile.',
    }
  }

  if (!ownerWebId) {
    return {
      status: 'no-op',
      message: 'No owner WebID is available for saving.',
    }
  }

  try {
    const result = await executeProfileSaveFlow({
      ownerWebId,
      currentProfile,
      interestsInput,
      deps,
    })

    return {
      status: 'saved',
      message: result.privatePreferencesSaved
        ? 'Your profile has been updated in your Solid Pod.'
        : 'Your public profile has been updated in your Solid Pod.',
      mergedSavedProfile: result.mergedSavedProfile,
      mergedSavedInterestsInput: result.mergedSavedInterestsInput,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save profile. Please try again.'
    return {
      status: 'error',
      message,
      error,
    }
  }
}
