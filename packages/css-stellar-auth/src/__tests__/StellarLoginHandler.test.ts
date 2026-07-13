/**
 * Unit tests for StellarLoginHandler.
 *
 * Exercises the three validation layers — missing fields, untrusted
 * tokenVerifyUrl, failed/invalid provisioner response — and the happy path
 * where the handler resolves an accountId and returns it for cookie issuance.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { StellarLoginHandler } from '../StellarLoginHandler.js'
import { createHmac } from 'node:crypto'

// ---------------------------------------------------------------------------
// Minimal CSS dependency stubs
// ---------------------------------------------------------------------------

class StubAccountStore {
  async updateSetting(): Promise<void> {}
}
class StubCookieStore {
  async generate(accountId: string): Promise<string> {
    return `cookie-for-${accountId}`
  }
}

function makeStorage(records: Array<{ id: string; webId: string; accountId: string }>) {
  return {
    async find(_type: string, filter: Record<string, string>) {
      return records.filter((r) => r.webId === filter.webId)
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-shared-secret-32-bytes-long!!'
const PROVISIONER_ORIGIN = 'https://staging.nodezero.social'
const TEST_WEB_ID = 'https://solid.nodezero.social/alice/profile/card#me'
const TEST_ACCOUNT_ID = 'account-uuid-alice'

// Set defaults so tests that don't override get sensible values
process.env.NZ_STELLAR_AUTH_PROVISIONER_ORIGINS = PROVISIONER_ORIGIN
process.env.NZ_STELLAR_AUTH_SHARED_SECRET = TEST_SECRET

function makeHandler(overrides: Partial<{
  storage: ReturnType<typeof makeStorage>
  origins: string
  secret: string
}> = {}) {
  if (overrides.origins !== undefined) process.env.NZ_STELLAR_AUTH_PROVISIONER_ORIGINS = overrides.origins
  if (overrides.secret !== undefined) process.env.NZ_STELLAR_AUTH_SHARED_SECRET = overrides.secret
  return new StellarLoginHandler(
    new StubAccountStore() as never,
    new StubCookieStore() as never,
    (overrides.storage ?? makeStorage([])) as never,
  )
}

function makeInput(json: Record<string, unknown>): { json: Record<string, unknown>; metadata: object; target: object } {
  return { json, metadata: {}, target: {} }
}

function validHmac(token: string): string {
  return createHmac('sha256', TEST_SECRET)
    .update(`${token}:nz-css-stellar-login-v1`)
    .digest('hex')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void test('login() rejects when loginToken is missing', async () => {
  const handler = makeHandler()
  await assert.rejects(
    handler.login(makeInput({ tokenVerifyUrl: `${PROVISIONER_ORIGIN}/v1/auth/stellar-verify` })),
    /loginToken is required/,
  )
})

void test('login() rejects when tokenVerifyUrl is missing', async () => {
  const handler = makeHandler()
  await assert.rejects(
    handler.login(makeInput({ loginToken: 'some-token' })),
    /tokenVerifyUrl is required/,
  )
})

void test('login() rejects untrusted tokenVerifyUrl origin', async () => {
  const handler = makeHandler({ origins: PROVISIONER_ORIGIN })
  await assert.rejects(
    handler.login(makeInput({
      loginToken: 'tok',
      tokenVerifyUrl: 'https://evil.example.com/v1/auth/stellar-verify',
    })),
    /trusted provisioner allowlist/,
  )
})

void test('login() rejects non-https tokenVerifyUrl (non-localhost)', async () => {
  const handler = makeHandler({ origins: 'http://notlocal.example.com' })
  await assert.rejects(
    handler.login(makeInput({
      loginToken: 'tok',
      tokenVerifyUrl: 'http://notlocal.example.com/v1/auth/stellar-verify',
    })),
    /trusted provisioner allowlist/,
  )
})

void test('login() rejects when provisioner returns invalid=false', async () => {
  const token = 'test-token-abc'
  const handler = makeHandler({
    origins: PROVISIONER_ORIGIN,
  })

  // Override fetch for this test
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), `${PROVISIONER_ORIGIN}/v1/auth/stellar-verify`)
    const body = JSON.parse(init?.body as string)
    assert.equal(body.token, token)
    assert.equal(body.audience, 'nz-css-stellar-login-v1')
    const expectedHmac = validHmac(token)
    assert.equal((init?.headers as Record<string, string>)['x-nz-stellar-auth'], expectedHmac)
    return new Response(JSON.stringify({ valid: false }), { status: 200 })
  }

  try {
    await assert.rejects(
      handler.login(makeInput({
        loginToken: token,
        tokenVerifyUrl: `${PROVISIONER_ORIGIN}/v1/auth/stellar-verify`,
      })),
      /invalid or has expired/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('login() rejects when provisioner returns non-200', async () => {
  const handler = makeHandler({ origins: PROVISIONER_ORIGIN })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('Unauthorized', { status: 401 })

  try {
    await assert.rejects(
      handler.login(makeInput({
        loginToken: 'tok',
        tokenVerifyUrl: `${PROVISIONER_ORIGIN}/v1/auth/stellar-verify`,
      })),
      /401/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('login() rejects when no CSS account is linked to the webId', async () => {
  const handler = makeHandler({
    origins: PROVISIONER_ORIGIN,
    storage: makeStorage([]), // no records
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ valid: true, webId: TEST_WEB_ID }), { status: 200 })

  try {
    await assert.rejects(
      handler.login(makeInput({
        loginToken: 'tok',
        tokenVerifyUrl: `${PROVISIONER_ORIGIN}/v1/auth/stellar-verify`,
      })),
      /No CSS account is linked/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('login() returns accountId and remember=true on success', async () => {
  const token = 'valid-token-xyz'
  const handler = makeHandler({
    origins: PROVISIONER_ORIGIN,
    storage: makeStorage([{ id: 'link-1', webId: TEST_WEB_ID, accountId: TEST_ACCOUNT_ID }]),
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ valid: true, webId: TEST_WEB_ID }), { status: 200 })

  try {
    const result = await handler.login(makeInput({
      loginToken: token,
      tokenVerifyUrl: `${PROVISIONER_ORIGIN}/v1/auth/stellar-verify`,
    }))
    assert.equal(result.json.accountId, TEST_ACCOUNT_ID)
    assert.equal(result.json.remember, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('login() localhost http tokenVerifyUrl is allowed', async () => {
  const handler = makeHandler({
    origins: 'http://localhost:3000',
    storage: makeStorage([{ id: 'link-1', webId: TEST_WEB_ID, accountId: TEST_ACCOUNT_ID }]),
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ valid: true, webId: TEST_WEB_ID }), { status: 200 })

  try {
    const result = await handler.login(makeInput({
      loginToken: 'tok',
      tokenVerifyUrl: 'http://localhost:3000/v1/auth/stellar-verify',
    }))
    assert.equal(result.json.accountId, TEST_ACCOUNT_ID)
  } finally {
    globalThis.fetch = originalFetch
  }
})
