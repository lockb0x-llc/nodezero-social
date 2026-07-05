import type { ConnectionRecord } from '../SocialGraphContract.js'

export const validSocialGraphFixtures: ConnectionRecord[] = [
  { webId: 'https://alice.example/profile/card#me' },
  { webId: 'https://bob.example/id#nodezero' },
]

export const invalidSocialGraphFixtures: unknown[] = [
  { webId: '' },
  { webId: 'https://alice.example/profile/card' },
  { webId: 'not-a-url' },
]
