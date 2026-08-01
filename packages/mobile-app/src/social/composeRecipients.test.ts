import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { resolveAudienceRecipients } from './composeRecipients'

const accepted = [
  'https://solid.nodezero.social/a/profile/card#me',
  'https://solid.nodezero.social/b/profile/card#me',
]

void test('foaf and verified audiences contain only accepted unblocked relationships', () => {
  for (const audience of ['foaf', 'verified'] as const) {
    const recipients = resolveAudienceRecipients({
      audience,
      acceptedRelationships: [...accepted, accepted[0]],
      trustCircleMembers: ['https://solid.nodezero.social/directory-only/profile/card#me'],
      blockedWebIds: [accepted[1]],
    })

    assert.deepEqual(recipients, [accepted[0]])
  }
})

void test('trust-circle membership narrows accepted relationships and never grants delivery', () => {
  const recipients = resolveAudienceRecipients({
    audience: 'trust-circle',
    acceptedRelationships: accepted,
    trustCircleMembers: [
      accepted[1],
      'https://solid.nodezero.social/directory-only/profile/card#me',
      accepted[1],
    ],
    blockedWebIds: [],
  })

  assert.deepEqual(recipients, [accepted[1]])
})

void test('block precedence removes accepted Trust Circle members', () => {
  const recipients = resolveAudienceRecipients({
    audience: 'trust-circle',
    acceptedRelationships: accepted,
    trustCircleMembers: accepted,
    blockedWebIds: accepted,
  })

  assert.deepEqual(recipients, [])
})

void test('directory-only and local inputs cannot become directed recipients', () => {
  const directoryOnly = 'https://solid.nodezero.social/directory-only/profile/card#me'
  assert.deepEqual(resolveAudienceRecipients({
    audience: 'verified',
    acceptedRelationships: [],
    trustCircleMembers: [directoryOnly],
    blockedWebIds: [],
  }), [])
  assert.deepEqual(resolveAudienceRecipients({
    audience: 'local',
    acceptedRelationships: accepted,
    trustCircleMembers: accepted,
    blockedWebIds: [],
  }), [])
})
