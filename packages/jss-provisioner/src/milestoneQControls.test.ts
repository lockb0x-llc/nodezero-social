import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { MilestoneQControls, parseDisabledFeatures } from './milestoneQControls.js'

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

void test('NC-10: the runtime kill-switch disables a feature for every authenticated WebID', () => {
  const controls = new MilestoneQControls({ disabledFeatures: ['transport'] })

  assert.equal(controls.isEnabled('transport', alice), false)
  assert.equal(controls.isEnabled('transport', bob), false)
  assert.equal(controls.isConfigured('transport'), false)
  assert.equal(controls.flags().transport, false)
  assert.equal(controls.availability(alice).transport, false)

  // Unaffected features stay available.
  assert.equal(controls.isEnabled('directory', alice), true)
  assert.equal(controls.flags().directory, true)
})

void test('NC-10: the kill-switch parses a feature list and ignores unknown names', () => {
  assert.deepEqual(parseDisabledFeatures('transport, directory'), ['transport', 'directory'])
  assert.deepEqual(parseDisabledFeatures('TRANSPORT'), ['transport'])
  assert.deepEqual(parseDisabledFeatures('not-a-feature'), [])
  assert.deepEqual(parseDisabledFeatures(undefined), [])
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
