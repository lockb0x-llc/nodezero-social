import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { getProfileSaveValidationMessage } from './profileValidation'

void test('getProfileSaveValidationMessage returns null for valid profile', () => {
  const message = getProfileSaveValidationMessage({
    displayName: 'Alice',
    bio: 'Bio',
    avatarUrl: 'https://example.com/avatar.png',
    externalUrl: 'https://example.com',
    interests: ['solid', 'privacy'],
    isNsfw: false,
  })

  assert.equal(message, null)
})

void test('getProfileSaveValidationMessage flags excessive display name length', () => {
  const message = getProfileSaveValidationMessage({
    displayName: 'A'.repeat(81),
    bio: 'Bio',
    interests: [],
    isNsfw: false,
  })

  assert.equal(message, 'Display name must be 80 characters or fewer.')
})

void test('getProfileSaveValidationMessage flags invalid external URL', () => {
  const message = getProfileSaveValidationMessage({
    displayName: 'Alice',
    bio: 'Bio',
    externalUrl: 'javascript:alert(1)',
    interests: [],
    isNsfw: false,
  })

  assert.equal(message, 'External URL must be an absolute http(s) URL.')
})
