import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { usableIdentityCandidates } from './identitySignInCandidates.js'

void test('orders the active usable identity before other stored identities', () => {
  const candidates = usableIdentityCandidates([
    {
      keyId: 'secondary',
      label: 'Secondary',
      createdAt: '',
      lastUsedAt: null,
      stellarPublicKey: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      secretAvailable: true,
      active: false,
    },
    {
      keyId: 'active',
      label: 'Active',
      createdAt: '',
      lastUsedAt: null,
      stellarPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      secretAvailable: true,
      active: true,
    },
  ])

  assert.deepEqual(candidates.map((candidate) => candidate.keyId), ['active', 'secondary'])
})

void test('skips damaged identities while retaining later usable identities', () => {
  const candidates = usableIdentityCandidates([
    {
      keyId: 'damaged',
      label: 'Damaged',
      createdAt: '',
      lastUsedAt: null,
      stellarPublicKey: null,
      secretAvailable: false,
      active: true,
    },
    {
      keyId: 'usable',
      label: 'Usable',
      createdAt: '',
      lastUsedAt: null,
      stellarPublicKey: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      secretAvailable: true,
      active: false,
    },
  ])

  assert.deepEqual(candidates, [
    {
      keyId: 'usable',
      stellarPublicKey: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      active: false,
    },
  ])
})
