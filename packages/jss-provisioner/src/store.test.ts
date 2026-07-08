import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { ProvisionStore } from './store.js'

void test('OIDC bridge ticket default TTL is approximately 15 minutes', () => {
  delete process.env.JSS_OIDC_BRIDGE_TTL_MS
  const store = new ProvisionStore()
  const issuedAt = Date.now()

  const ticket = store.issueOidcBridgeTicket({
    email: 'qa@example.com',
    password: 'correct horse battery staple',
    webId: 'https://solid.nodezero.social/qa/profile/card#me',
    podUrl: 'https://solid.nodezero.social/qa/',
  })

  const expiresAtMs = new Date(ticket.expiresAt).getTime()
  const ttlMs = expiresAtMs - issuedAt

  assert.ok(ttlMs >= 14 * 60_000, `Expected TTL >= 14 minutes, got ${ttlMs}ms`)
  assert.ok(ttlMs <= 16 * 60_000, `Expected TTL <= 16 minutes, got ${ttlMs}ms`)
})

void test('OIDC bridge TTL respects JSS_OIDC_BRIDGE_TTL_MS override', () => {
  process.env.JSS_OIDC_BRIDGE_TTL_MS = '120000'
  const store = new ProvisionStore()
  const issuedAt = Date.now()

  const ticket = store.issueOidcBridgeTicket({
    email: 'qa@example.com',
    password: 'correct horse battery staple',
    webId: 'https://solid.nodezero.social/qa/profile/card#me',
    podUrl: 'https://solid.nodezero.social/qa/',
  })

  const expiresAtMs = new Date(ticket.expiresAt).getTime()
  const ttlMs = expiresAtMs - issuedAt

  assert.ok(ttlMs >= 110000, `Expected TTL >= 110000ms, got ${ttlMs}ms`)
  assert.ok(ttlMs <= 130000, `Expected TTL <= 130000ms, got ${ttlMs}ms`)

  delete process.env.JSS_OIDC_BRIDGE_TTL_MS
})
