/**
 * Regression tests for the P3 Treasury-sponsored account creation guards.
 *
 * Run with the zero-dependency Node built-in test runner via tsx:
 *   pnpm --filter @nodezero/jss-provisioner test
 *
 * These cover the fail-closed input validation that executes BEFORE any network
 * or `stellar` CLI interaction, so they run fully offline.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { treasuryCreateAccount } from './treasuryCreateAccount.js'

// A syntactically valid Stellar public key (format only; never funded by tests).
const VALID_G = 'GAUMNOPBK5WYUGIV2VH7JXMHACFSB4QV4HCJM5LB7ERUYKUN6UEZGEYI'

void test('rejects a malformed destination public key before any network call', async () => {
  await assert.rejects(
    () => treasuryCreateAccount('not-a-stellar-key'),
    /valid Stellar public key/i,
  )
})

void test('rejects an empty destination', async () => {
  await assert.rejects(() => treasuryCreateAccount(''), /valid Stellar public key/i)
})

void test('rejects a non-positive starting balance (clamped to 0)', async () => {
  await assert.rejects(
    () => treasuryCreateAccount(VALID_G, 0),
    /greater than 0/i,
  )
  await assert.rejects(
    () => treasuryCreateAccount(VALID_G, -5),
    /greater than 0/i,
  )
})

void test('retries a transient Stellar connection failure and succeeds', async () => {
  let submissions = 0
  const txHash = 'a'.repeat(64)
  const result = await treasuryCreateAccount(VALID_G, 1, {
    accountExists: async () => false,
    getTreasurySourceAccount: () => 'treasury-test',
    runStellar: async () => {
      submissions += 1
      if (submissions === 1) throw new Error('error: client error (Connect)')
      return txHash
    },
    sleep: async () => undefined,
    retryAttempts: 3,
    retryBaseDelayMs: 0,
  })

  assert.equal(submissions, 2)
  assert.equal(result.created, true)
  assert.equal(result.txHash, txHash)
})

void test('treats an existing account after response loss as success', async () => {
  let existenceChecks = 0
  let submissions = 0
  const result = await treasuryCreateAccount(VALID_G, 1, {
    accountExists: async () => {
      existenceChecks += 1
      return existenceChecks > 1
    },
    getTreasurySourceAccount: () => 'treasury-test',
    runStellar: async () => {
      submissions += 1
      throw new Error('error: client error (Connect)')
    },
    sleep: async () => undefined,
    retryAttempts: 3,
    retryBaseDelayMs: 0,
  })

  assert.equal(submissions, 1)
  assert.equal(result.alreadyExisted, true)
  assert.equal(result.created, false)
})

void test('fails closed after bounded transient connection retries', async () => {
  let submissions = 0
  await assert.rejects(
    () => treasuryCreateAccount(VALID_G, 1, {
      accountExists: async () => false,
      getTreasurySourceAccount: () => 'treasury-test',
      runStellar: async () => {
        submissions += 1
        throw new Error('error: client error (Connect)')
      },
      sleep: async () => undefined,
      retryAttempts: 3,
      retryBaseDelayMs: 0,
    }),
    /failed after 3 attempts/i,
  )
  assert.equal(submissions, 3)
})
