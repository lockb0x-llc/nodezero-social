import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  buildPrivatePreferencesPayload,
  buildUpdatedProfileDraft,
  interestsToInput,
  mergeProfileData,
  parseInterestsInput,
} from './mergeProfileData'

void test('mergeProfileData overlays private preferences on public profile', () => {
  const merged = mergeProfileData(
    {
      displayName: 'Alice',
      bio: 'Bio',
      avatarUrl: 'https://example.com/avatar.png',
      externalUrl: 'https://example.com',
      interests: ['public-ignored'],
      isNsfw: false,
    },
    {
      interests: ['solid', 'privacy'],
      isNsfw: true,
    },
  )

  assert.deepEqual(merged.interests, ['solid', 'privacy'])
  assert.equal(merged.isNsfw, true)
  assert.equal(merged.displayName, 'Alice')
})

void test('mergeProfileData uses safe defaults when private preferences are missing', () => {
  const merged = mergeProfileData(
    {
      displayName: 'Bob',
      bio: 'Bio',
      interests: ['public-ignored'],
      isNsfw: true,
    },
    null,
  )

  assert.deepEqual(merged.interests, [])
  assert.equal(merged.isNsfw, false)
  assert.equal(merged.displayName, 'Bob')
})

void test('interestsToInput formats interests as comma-separated text', () => {
  assert.equal(interestsToInput(['solid', 'stellar', 'zk']), 'solid, stellar, zk')
})

void test('parseInterestsInput trims and removes empty values', () => {
  assert.deepEqual(
    parseInterestsInput(' solid,  stellar ,, zk , '),
    ['solid', 'stellar', 'zk'],
  )
})

void test('buildUpdatedProfileDraft applies parsed interests to draft', () => {
  const draft = buildUpdatedProfileDraft(
    {
      displayName: 'Alice',
      bio: 'Bio',
      interests: [],
      isNsfw: false,
    },
    'nodezero, privacy'
  )

  assert.deepEqual(draft.interests, ['nodezero', 'privacy'])
  assert.equal(draft.displayName, 'Alice')
})

void test('buildPrivatePreferencesPayload derives NSFW flag from shared policy helper', () => {
  const payload = buildPrivatePreferencesPayload({
    displayName: 'Creator',
    bio: 'Bio',
    externalUrl: 'https://onlyfans.com/creator',
    interests: ['creator-economy'],
    isNsfw: false,
  })

  assert.deepEqual(payload.interests, ['creator-economy'])
  assert.equal(payload.isNsfw, true)
})
