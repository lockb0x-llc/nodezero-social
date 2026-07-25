import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { UserProfile } from '@nodezero/solid-pod-sync'
import type { ProfileSaveDependencies } from './saveProfileFlow'
import { saveProfileForScreen } from './profileSaveCoordinator'

const sampleProfile: UserProfile = {
  displayName: 'Alice',
  bio: 'Bio',
  interests: ['web3'],
  isNsfw: false,
}

function createDeps(overrides?: {
  readPublicProfile?: ProfileSaveDependencies['readPublicProfile']
  readPrivatePreferences?: ProfileSaveDependencies['readPrivatePreferences']
  writePublicProfile?: ProfileSaveDependencies['writePublicProfile']
  writePrivatePreferences?: ProfileSaveDependencies['writePrivatePreferences']
}): ProfileSaveDependencies {
  return {
    writePublicProfile: overrides?.writePublicProfile ?? (async (_podRoot, _profile) => {}),
    writePrivatePreferences:
      overrides?.writePrivatePreferences ?? (async (_podRoot, _preferences) => {}),
    readPublicProfile: overrides?.readPublicProfile ?? (async (_webId) => sampleProfile),
    readPrivatePreferences:
      overrides?.readPrivatePreferences ??
      (async (_podRoot) => ({ interests: [], isNsfw: false })),
  }
}

void test('saveProfileForScreen blocks save in peer view', async () => {
  const result = await saveProfileForScreen({
    isPeerView: true,
    ownerWebId: 'https://solid.nodezero.social/alice/profile/card#me',
    currentProfile: sampleProfile,
    interestsInput: 'web3',
    deps: createDeps(),
  })

  assert.equal(result.status, 'read-only')
  assert.equal(result.message, 'You can only edit your own profile.')
})

void test('saveProfileForScreen no-ops when ownerWebId is unavailable', async () => {
  const result = await saveProfileForScreen({
    isPeerView: false,
    ownerWebId: null,
    currentProfile: sampleProfile,
    interestsInput: 'web3',
    deps: createDeps(),
  })

  assert.equal(result.status, 'no-op')
})

void test('saveProfileForScreen returns saved outcome on happy path', async () => {
  let wrotePublic = false
  let wrotePrivate = false

  const result = await saveProfileForScreen({
    isPeerView: false,
    ownerWebId: 'https://solid.nodezero.social/alice/profile/card#me',
    currentProfile: sampleProfile,
    interestsInput: 'web3, privacy',
    deps: createDeps({
      writePublicProfile: async () => {
        wrotePublic = true
      },
      writePrivatePreferences: async () => {
        wrotePrivate = true
      },
      readPublicProfile: async () => ({ ...sampleProfile, interests: ['web3', 'privacy'] }),
      readPrivatePreferences: async () => ({
        interests: ['web3', 'privacy'],
        isNsfw: false,
      }),
    }),
  })

  assert.equal(result.status, 'saved')
  assert.equal(wrotePublic, true)
  assert.equal(wrotePrivate, true)
  if (result.status === 'saved') {
    assert.deepEqual(result.mergedSavedProfile?.interests, ['web3', 'privacy'])
  }
})

void test('saveProfileForScreen returns error outcome on write failure', async () => {
  const result = await saveProfileForScreen({
    isPeerView: false,
    ownerWebId: 'https://solid.nodezero.social/alice/profile/card#me',
    currentProfile: sampleProfile,
    interestsInput: 'web3',
    deps: createDeps({
      writePublicProfile: async () => {
        throw new Error('write failed')
      },
    }),
  })

  assert.equal(result.status, 'error')
  if (result.status === 'error') {
    assert.equal(result.message, 'write failed')
  }
})
