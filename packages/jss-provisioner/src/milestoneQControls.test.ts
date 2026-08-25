import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { hashCohortIdentity, MilestoneQControls } from './milestoneQControls.js'

const alice = 'https://solid.nodezero.social/alice/profile/card#me'

void test('all Milestone Q features default off', () => {
  const controls = new MilestoneQControls()
  assert.deepEqual(controls.flags(), {
    directory: false,
    'peer-profile': false,
    relationship: false,
    transport: false,
  })
  assert.equal(controls.isEnabled('directory', alice), false)
})

void test('hashed cohort restricts an enabled feature without storing WebIDs', () => {
  const controls = new MilestoneQControls({
    directoryEnabled: true,
    cohortKey: 'test-cohort-key',
    cohortHashes: [hashCohortIdentity(alice, 'test-cohort-key')],
  })
  assert.equal(controls.isEnabled('directory', alice), true)
  assert.equal(
    controls.isEnabled('directory', 'https://solid.nodezero.social/bob/profile/card#me'),
    false
  )
  assert.equal(JSON.stringify(controls).includes(alice), false)
  assert.deepEqual(controls.availability(alice), {
    directory: true,
    peerProfile: false,
    relationship: false,
    transport: false,
  })
  assert.deepEqual(controls.availability('https://solid.nodezero.social/bob/profile/card#me'), {
    directory: false,
    peerProfile: false,
    relationship: false,
    transport: false,
  })
})

void test('telemetry snapshots contain aggregate feature outcomes only', () => {
  const emitted: Array<{ metric: string; value: number }> = []
  const controls = new MilestoneQControls({
    transportEnabled: true,
    metricSink: (metric, value): void => {
      emitted.push({ metric, value })
    },
  })
  controls.count('transport', 'verified')
  controls.count('transport', 'verified')
  controls.count('transport', 'rate limited')
  assert.deepEqual(emitted, [
    { metric: 'transport.verified', value: 1 },
    { metric: 'transport.verified', value: 2 },
    { metric: 'transport.rate-limited', value: 1 },
  ])
  assert.equal(JSON.stringify(emitted).includes('https://'), false)
})

void test('enabled features fail closed when cohort hashes or key are missing', () => {
  assert.equal(new MilestoneQControls({ directoryEnabled: true }).isEnabled('directory'), false)
  assert.equal(
    new MilestoneQControls({
      directoryEnabled: true,
      cohortKey: 'key',
    }).isEnabled('directory'),
    false
  )
  assert.equal(
    new MilestoneQControls({
      directoryEnabled: true,
      cohortHashes: ['hash'],
    }).isEnabled('directory'),
    false
  )
})

void test('allowAll enables features for all authenticated users without cohort hashes', () => {
  const controls = new MilestoneQControls({
    directoryEnabled: true,
    relationshipEnabled: true,
    transportEnabled: true,
    peerProfileEnabled: true,
    allowAll: true,
  })
  assert.equal(controls.isEnabled('directory', alice), true)
  assert.equal(
    controls.isEnabled('directory', 'https://solid.nodezero.social/bob/profile/card#me'),
    true
  )
  assert.deepEqual(controls.availability(alice), {
    directory: true,
    peerProfile: true,
    relationship: true,
    transport: true,
  })
})

void test('wildcard cohort hash enables features for all users', () => {
  const controls = new MilestoneQControls({
    directoryEnabled: true,
    cohortHashes: ['*'],
  })
  assert.equal(controls.isEnabled('directory', alice), true)
  assert.equal(
    controls.isEnabled('directory', 'https://solid.nodezero.social/charlie/profile/card#me'),
    true
  )
})
