import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  derivePodRootFromWebId,
  executeProfileSaveFlow,
  type ProfileSaveDependencies,
} from './saveProfileFlow'

void test('derivePodRootFromWebId returns deterministic pod root', () => {
  assert.equal(
    derivePodRootFromWebId('https://solid.nodezero.social/alice/profile/card#me'),
    'https://solid.nodezero.social/alice/',
  )
})

void test('executeProfileSaveFlow writes public/private profile and re-reads merged result', async () => {
  const calls: string[] = []
  const deps: ProfileSaveDependencies = {
    writePublicProfile: async (podRoot, profile) => {
      calls.push(`writePublic:${podRoot}`)
      assert.equal(profile.displayName, 'Alice')
      assert.deepEqual(profile.interests, ['solid', 'privacy'])
    },
    writePrivatePreferences: async (podRoot, preferences) => {
      calls.push(`writePrivate:${podRoot}`)
      assert.deepEqual(preferences.interests, ['solid', 'privacy'])
      assert.equal(preferences.isNsfw, true)
    },
    readPublicProfile: async (webId) => {
      calls.push(`readPublic:${webId}`)
      return {
        displayName: 'Alice Saved',
        bio: 'Updated',
        externalUrl: 'https://onlyfans.com/alice',
        interests: [],
        isNsfw: false,
      }
    },
    readPrivatePreferences: async (podRoot) => {
      calls.push(`readPrivate:${podRoot}`)
      return {
        interests: ['solid', 'privacy'],
        isNsfw: true,
      }
    },
  }

  const result = await executeProfileSaveFlow({
    ownerWebId: 'https://solid.nodezero.social/alice/profile/card#me',
    currentProfile: {
      displayName: 'Alice',
      bio: 'Bio',
      externalUrl: 'https://onlyfans.com/alice',
      interests: [],
      isNsfw: false,
    },
    interestsInput: 'solid, privacy',
    deps,
  })

  assert.equal(result.podRoot, 'https://solid.nodezero.social/alice/')
  assert.deepEqual(result.updatedProfile.interests, ['solid', 'privacy'])
  assert.equal(result.preferencesPayload.isNsfw, true)
  assert.equal(result.mergedSavedProfile?.displayName, 'Alice Saved')
  assert.deepEqual(result.mergedSavedProfile?.interests, ['solid', 'privacy'])
  assert.equal(result.mergedSavedInterestsInput, 'solid, privacy')

  assert.deepEqual(calls, [
    'writePublic:https://solid.nodezero.social/alice/',
    'writePrivate:https://solid.nodezero.social/alice/',
    'readPublic:https://solid.nodezero.social/alice/profile/card#me',
    'readPrivate:https://solid.nodezero.social/alice/',
  ])
})

void test('executeProfileSaveFlow returns null merged state when public re-read is missing', async () => {
  const deps: ProfileSaveDependencies = {
    writePublicProfile: async () => undefined,
    writePrivatePreferences: async () => undefined,
    readPublicProfile: async () => null,
    readPrivatePreferences: async () => ({ interests: ['x'], isNsfw: false }),
  }

  const result = await executeProfileSaveFlow({
    ownerWebId: 'https://solid.nodezero.social/alice/profile/card#me',
    currentProfile: {
      displayName: 'Alice',
      bio: 'Bio',
      interests: [],
      isNsfw: false,
    },
    interestsInput: 'x',
    deps,
  })

  assert.equal(result.mergedSavedProfile, null)
  assert.equal(result.mergedSavedInterestsInput, null)
})
