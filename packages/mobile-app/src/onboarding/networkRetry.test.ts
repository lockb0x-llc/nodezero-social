import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { retryNetworkOperation } from './networkRetry.js'

void test('retries thrown network failures with the configured delays', async () => {
  let attempts = 0
  const delays: number[] = []
  const result = await retryNetworkOperation(
    async () => {
      attempts += 1
      if (attempts < 3) throw new TypeError('Failed to fetch')
      return 'ok'
    },
    [1_000, 2_000],
    async (delayMs) => {
      delays.push(delayMs)
    },
  )

  assert.equal(result, 'ok')
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [1_000, 2_000])
})

void test('returns HTTP responses without retrying them', async () => {
  let attempts = 0
  const response = { ok: false, status: 503 }
  const result = await retryNetworkOperation(
    async () => {
      attempts += 1
      return response
    },
    [1_000, 2_000],
  )

  assert.equal(result, response)
  assert.equal(attempts, 1)
})

void test('rethrows after exhausting network retries', async () => {
  let attempts = 0
  const failure = new TypeError('Failed to fetch')
  await assert.rejects(
    retryNetworkOperation(
      async () => {
        attempts += 1
        throw failure
      },
      [1_000, 2_000],
      async () => undefined,
    ),
    failure,
  )
  assert.equal(attempts, 3)
})