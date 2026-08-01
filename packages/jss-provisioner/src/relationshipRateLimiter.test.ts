import assert from 'node:assert/strict'
import test from 'node:test'
import { RelationshipRateLimiter } from './relationshipRateLimiter.js'

void test('rate limits relationship endpoint floods per identity and resets after the window', () => {
  const limiter = new RelationshipRateLimiter({ maxRequests: 2, windowMs: 60_000 })

  assert.deepEqual(limiter.consume('alice', 1_000), {
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 0,
  })
  assert.equal(limiter.consume('alice', 2_000).allowed, true)
  assert.deepEqual(limiter.consume('alice', 3_000), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 58,
  })
  assert.equal(limiter.consume('bob', 3_000).allowed, true)
  assert.equal(limiter.consume('alice', 61_000).allowed, true)
})

void test('fails closed for new identities when the tracked-key budget is exhausted', () => {
  const limiter = new RelationshipRateLimiter({
    maxRequests: 1,
    windowMs: 60_000,
    maxKeys: 2,
  })

  limiter.consume('alice', 1_000)
  limiter.consume('bob', 1_000)
  assert.equal(limiter.consume('carol', 1_000).allowed, false)

  assert.equal(limiter.consume('bob', 2_000).allowed, false)
  assert.equal(limiter.consume('alice', 2_000).allowed, false)
  assert.equal(limiter.consume('carol', 61_000).allowed, true)
})
