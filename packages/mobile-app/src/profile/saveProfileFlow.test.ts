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

void test('executeProfileSaveFlow rejects invalid avatar URL before write operations', async () => {
  let wrotePublic = false
  let wrotePrivate = false

  const deps: ProfileSaveDependencies = {
    writePublicProfile: async () => {
      wrotePublic = true
    },
    writePrivatePreferences: async () => {
      wrotePrivate = true
    },
    readPublicProfile: async () => null,
    readPrivatePreferences: async () => null,
  }

  await assert.rejects(
    () =>
      executeProfileSaveFlow({
        ownerWebId: 'https://solid.nodezero.social/alice/profile/card#me',
        currentProfile: {
          displayName: 'Alice',
          bio: 'Bio',
          avatarUrl: 'javascript:alert(1)',
          interests: [],
          isNsfw: false,
        },
        interestsInput: 'x',
        deps,
      }),
    /Avatar URL must be an absolute http\(s\) URL\./,
  )

  assert.equal(wrotePublic, false)
  assert.equal(wrotePrivate, false)
})

void test('executeProfileSaveFlow rejects display name longer than 80 characters', async () => {
  const deps: ProfileSaveDependencies = {
    writePublicProfile: async () => undefined,
    writePrivatePreferences: async () => undefined,
    readPublicProfile: async () => null,
    readPrivatePreferences: async () => null,
  }

  await assert.rejects(
    () =>
      executeProfileSaveFlow({
        ownerWebId: 'https://solid.nodezero.social/alice/profile/card#me',
        currentProfile: {
          displayName: 'A'.repeat(81),
          bio: 'Bio',
          interests: [],
          isNsfw: false,
        },
        interestsInput: 'x',
        deps,
      }),
    /Display name must be 80 characters or fewer\./,
  )
})

void test('executeProfileSaveFlow rejects bio longer than 280 characters', async () => {
  const deps: ProfileSaveDependencies = {
    writePublicProfile: async () => undefined,
    writePrivatePreferences: async () => undefined,
    readPublicProfile: async () => null,
    readPrivatePreferences: async () => null,
  }

  await assert.rejects(
    () =>
      executeProfileSaveFlow({
        ownerWebId: 'https://solid.nodezero.social/alice/profile/card#me',
        currentProfile: {
          displayName: 'Alice',
          bio: 'B'.repeat(281),
          interests: [],
          isNsfw: false,
        },
        interestsInput: 'x',
        deps,
      }),
    /Bio must be 280 characters or fewer\./,
  )
})

void test('executeProfileSaveFlow rejects more than 20 interests', async () => {
  const deps: ProfileSaveDependencies = {
    writePublicProfile: async () => undefined,
    writePrivatePreferences: async () => undefined,
    readPublicProfile: async () => null,
    readPrivatePreferences: async () => null,
  }

  const interestsInput = Array.from({ length: 21 }, (_, index) => `topic${index + 1}`).join(', ')

  await assert.rejects(
    () =>
      executeProfileSaveFlow({
        ownerWebId: 'https://solid.nodezero.social/alice/profile/card#me',
        currentProfile: {
          displayName: 'Alice',
          bio: 'Bio',
          interests: [],
          isNsfw: false,
        },
        interestsInput,
        deps,
      }),
    /You can add up to 20 interests\./,
  )
})

void test('executeProfileSaveFlow rejects interests longer than 40 characters', async () => {
  const deps: ProfileSaveDependencies = {
    writePublicProfile: async () => undefined,
    writePrivatePreferences: async () => undefined,
    readPublicProfile: async () => null,
    readPrivatePreferences: async () => null,
  }

  await assert.rejects(
    () =>
      executeProfileSaveFlow({
        ownerWebId: 'https://solid.nodezero.social/alice/profile/card#me',
        currentProfile: {
          displayName: 'Alice',
          bio: 'Bio',
          interests: [],
          isNsfw: false,
        },
        interestsInput: `${'x'.repeat(41)}`,
        deps,
      }),
    /Each interest must be 40 characters or fewer\./,
  )
})
