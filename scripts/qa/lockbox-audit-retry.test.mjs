import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForReleaseEvents } from './lockbox-audit-retry.mjs'

test('retries until the expected child event is indexed', async () => {
  let reads = 0
  let waits = 0
  const events = await waitForReleaseEvents({
    loadEvents: async () => {
      reads += 1
      return reads < 3 ? [] : [{ childId: 'child-a' }]
    },
    expectedChildIds: new Set(['child-a']),
    requireEvents: true,
    attempts: 4,
    delayMs: 10,
    readChildId: (event) => event.childId,
    wait: async () => {
      waits += 1
    },
  })

  assert.deepEqual(events, [{ childId: 'child-a' }])
  assert.equal(reads, 3)
  assert.equal(waits, 2)
})

test('returns the final snapshot when an expected child remains missing', async () => {
  let reads = 0
  const events = await waitForReleaseEvents({
    loadEvents: async () => {
      reads += 1
      return [{ id: 'other-event', childId: 'other-child' }]
    },
    expectedChildIds: new Set(['child-a']),
    requireEvents: true,
    attempts: 3,
    delayMs: 0,
    readChildId: (event) => event.childId,
    wait: async () => undefined,
  })

  assert.deepEqual(events, [{ id: 'other-event', childId: 'other-child' }])
  assert.equal(reads, 3)
})

test('does not retry when events are optional and no child is expected', async () => {
  let reads = 0
  await waitForReleaseEvents({
    loadEvents: async () => {
      reads += 1
      return []
    },
    expectedChildIds: new Set(),
    requireEvents: false,
    attempts: 5,
    delayMs: 10,
    readChildId: (event) => event.childId,
  })
  assert.equal(reads, 1)
})

test('retains malformed events observed before the expected child appears', async () => {
  let reads = 0
  const events = await waitForReleaseEvents({
    loadEvents: async () => {
      reads += 1
      return reads === 1
        ? [{ id: 'malformed', malformed: true }]
        : [{ id: 'expected', childId: 'child-a' }]
    },
    expectedChildIds: new Set(['child-a']),
    requireEvents: true,
    attempts: 2,
    delayMs: 0,
    readChildId: (event) => {
      if (event.malformed) throw new Error('malformed')
      return event.childId
    },
    wait: async () => undefined,
  })

  assert.deepEqual(
    events.map((event) => event.id),
    ['malformed', 'expected']
  )
})
