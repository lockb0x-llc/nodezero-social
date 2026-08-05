import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { hashMilestoneQCohortIdentity } from './hash-milestone-q-cohort.mjs'

void test('hashes normalized WebIDs deterministically without returning identity text', () => {
  const first = hashMilestoneQCohortIdentity(' https://solid.example/alice/profile/card#me ', 'key')
  const second = hashMilestoneQCohortIdentity(
    'https://solid.example/alice/profile/card#me',
    ' key '
  )
  assert.equal(first, second)
  assert.match(first, /^[0-9a-f]{64}$/)
  assert.equal(first.includes('alice'), false)
})

void test('rejects a missing key or WebID', () => {
  assert.throws(() => hashMilestoneQCohortIdentity('https://solid.example/alice', ''), /required/)
  assert.throws(() => hashMilestoneQCohortIdentity('', 'key'), /required/)
})
