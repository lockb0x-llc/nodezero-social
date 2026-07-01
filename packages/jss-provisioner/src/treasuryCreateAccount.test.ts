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
