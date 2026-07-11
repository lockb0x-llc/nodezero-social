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
    audience: 'nz-solid-css-login-v1',
    consumerOrigin: 'https://solid.nodezero.social',
    issuer: 'https://staging.nodezero.social',
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
    audience: 'nz-solid-css-login-v1',
    consumerOrigin: 'https://solid.nodezero.social',
    issuer: 'https://staging.nodezero.social',
  })

  const expiresAtMs = new Date(ticket.expiresAt).getTime()
  const ttlMs = expiresAtMs - issuedAt

  assert.ok(ttlMs >= 110000, `Expected TTL >= 110000ms, got ${ttlMs}ms`)
  assert.ok(ttlMs <= 130000, `Expected TTL <= 130000ms, got ${ttlMs}ms`)

  delete process.env.JSS_OIDC_BRIDGE_TTL_MS
})

void test('OIDC bridge ticket can be consumed only once with matching bindings', () => {
  const store = new ProvisionStore()
  const ticket = store.issueOidcBridgeTicket({
    email: 'qa@example.com',
    password: 'correct horse battery staple',
    webId: 'https://solid.nodezero.social/qa/profile/card#me',
    podUrl: 'https://solid.nodezero.social/qa/',
    audience: 'nz-solid-css-login-v1',
    consumerOrigin: 'https://solid.nodezero.social',
    issuer: 'https://staging.nodezero.social',
  })

  const first = store.consumeOidcBridgeTicket({
    token: ticket.token,
    audience: 'nz-solid-css-login-v1',
    consumerOrigin: 'https://solid.nodezero.social',
    issuer: 'https://staging.nodezero.social',
  })
  assert.ok(first)

  const second = store.consumeOidcBridgeTicket({
    token: ticket.token,
    audience: 'nz-solid-css-login-v1',
    consumerOrigin: 'https://solid.nodezero.social',
    issuer: 'https://staging.nodezero.social',
  })
  assert.equal(second, null)
})

void test('OIDC bridge consume fails when audience, origin, or issuer mismatch', () => {
  const store = new ProvisionStore()

  const issue = () =>
    store.issueOidcBridgeTicket({
      email: 'qa@example.com',
      password: 'correct horse battery staple',
      webId: 'https://solid.nodezero.social/qa/profile/card#me',
      podUrl: 'https://solid.nodezero.social/qa/',
      audience: 'nz-solid-css-login-v1',
      consumerOrigin: 'https://solid.nodezero.social',
      issuer: 'https://staging.nodezero.social',
    })

  const audienceMismatch = issue()
  assert.equal(
    store.consumeOidcBridgeTicket({
      token: audienceMismatch.token,
      audience: 'wrong-audience',
      consumerOrigin: 'https://solid.nodezero.social',
      issuer: 'https://staging.nodezero.social',
    }),
    null,
  )

  const originMismatch = issue()
  assert.equal(
    store.consumeOidcBridgeTicket({
      token: originMismatch.token,
      audience: 'nz-solid-css-login-v1',
      consumerOrigin: 'https://evil.example',
      issuer: 'https://staging.nodezero.social',
    }),
    null,
  )

  const issuerMismatch = issue()
  assert.equal(
    store.consumeOidcBridgeTicket({
      token: issuerMismatch.token,
      audience: 'nz-solid-css-login-v1',
      consumerOrigin: 'https://solid.nodezero.social',
      issuer: 'https://production.nodezero.social',
    }),
    null,
  )
})
