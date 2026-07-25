import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { resolveAudienceRecipients } from './composeRecipients'

void test('foaf recipients are derived from connections only', () => {
  const recipients = resolveAudienceRecipients({
    audience: 'foaf',
    connections: [
      'https://solid.nodezero.social/a/profile/card#me',
      'https://solid.nodezero.social/b/profile/card#me',
      'https://solid.nodezero.social/a/profile/card#me',
    ],
    trustCircleMembers: ['https://solid.nodezero.social/c/profile/card#me'],
  })

  assert.deepEqual(recipients, [
    'https://solid.nodezero.social/a/profile/card#me',
    'https://solid.nodezero.social/b/profile/card#me',
  ])
})

void test('verified recipients are derived from connections only', () => {
  const recipients = resolveAudienceRecipients({
    audience: 'verified',
    connections: ['https://solid.nodezero.social/v/profile/card#me'],
    trustCircleMembers: ['https://solid.nodezero.social/t/profile/card#me'],
  })

  assert.deepEqual(recipients, ['https://solid.nodezero.social/v/profile/card#me'])
})

void test('local audience does not target explicit WebID recipients', () => {
  const recipients = resolveAudienceRecipients({
    audience: 'local',
    connections: ['https://solid.nodezero.social/v/profile/card#me'],
    trustCircleMembers: ['https://solid.nodezero.social/t/profile/card#me'],
  })

  assert.deepEqual(recipients, [])
})

void test('trust-circle audience is derived from trust-circle members', () => {
  const recipients = resolveAudienceRecipients({
    audience: 'trust-circle',
    connections: ['https://solid.nodezero.social/v/profile/card#me'],
    trustCircleMembers: [
      'https://solid.nodezero.social/t/profile/card#me',
      'https://solid.nodezero.social/t/profile/card#me',
      'https://solid.nodezero.social/u/profile/card#me',
    ],
  })

  assert.deepEqual(recipients, [
    'https://solid.nodezero.social/t/profile/card#me',
    'https://solid.nodezero.social/u/profile/card#me',
  ])
})

void test('directory-only trust circle members do not change targeting', () => {
  const recipients = resolveAudienceRecipients({
    audience: 'verified',
    connections: [],
    trustCircleMembers: ['https://solid.nodezero.social/directory-only/profile/card#me'],
  })

  assert.deepEqual(recipients, [])
})
