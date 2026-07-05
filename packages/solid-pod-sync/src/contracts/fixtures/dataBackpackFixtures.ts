import type { DataBackpackProfile } from '../DataBackpackContract.js'

export const validDataBackpackFixtures: DataBackpackProfile[] = [
  {
    displayName: 'Alice',
    bio: 'Decentralized builder',
    avatarUrl: 'https://alice.example/avatar.png',
    externalUrl: 'https://alice.example/',
    interests: ['solid', 'privacy', 'stellar'],
    isNsfw: false,
  },
  {
    displayName: 'Riley',
    bio: '',
    interests: [],
    isNsfw: true,
  },
]

export const invalidDataBackpackFixtures: unknown[] = [
  {
    displayName: '',
    bio: 'Missing display name',
    interests: ['solid'],
    isNsfw: false,
  },
  {
    displayName: 'Dana',
    bio: 'Bad external URL',
    externalUrl: 'not-a-url',
    interests: ['solid'],
    isNsfw: false,
  },
  {
    displayName: 'Eli',
    bio: 'Blank interest not allowed',
    interests: [''],
    isNsfw: false,
  },
]
