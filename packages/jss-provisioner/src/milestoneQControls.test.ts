import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { MilestoneQControls } from './milestoneQControls.js'

const alice = 'https://solid.nodezero.social/alice/profile/card#me'
const bob = 'https://solid.nodezero.social/bob/profile/card#me'

void test('all Milestone Q features are always enabled for an authenticated WebID', () => {
  const controls = new MilestoneQControls()
  assert.deepEqual(controls.flags(), {
    directory: true,
    'peer-profile': true,
    relationship: true,
    transport: true,
  })
  assert.equal(controls.isEnabled('directory', alice), true)
  assert.equal(controls.isEnabled('directory', bob), true)
  assert.deepEqual(controls.availability(alice), {
    directory: true,
    peerProfile: true,
    relationship: true,
    transport: true,
  })
})

void test('features fail closed without an authenticated WebID', () => {
  const controls = new MilestoneQControls()
  assert.equal(controls.isEnabled('directory'), false)
  assert.equal(controls.isEnabled('transport', ''), false)
})

void test('telemetry snapshots contain aggregate feature outcomes only', () => {
  const emitted: Array<{ metric: string; value: number }> = []
  const controls = new MilestoneQControls({
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
