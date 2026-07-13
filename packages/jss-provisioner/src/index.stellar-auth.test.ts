/**
 * Stellar Auth provisioner endpoint tests.
 *
 * Tests the challenge/token/verify round-trip and all validation edge cases
 * using direct calls to handleHttpRequest.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { Keypair } from '@stellar/stellar-sdk'

async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const { handleHttpRequest } = await import('./index.js')
  const server = createServer((req, res) => {
    void handleHttpRequest(req, res).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Internal error'
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: msg }))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    ),
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const json: unknown = await resp.json().catch(() => null)
  return { status: resp.status, json }
}

const SHARED_SECRET = 'test-shared-secret-minimum-32-char!!'
process.env.NZ_STELLAR_AUTH_SHARED_SECRET = SHARED_SECRET
process.env.NZ_ENV_PROFILE = 'local'
process.env.JSS_ISSUER_URL = 'http://localhost:8181'
process.env.JSS_PUBLIC_PROVISIONER_BASE_URL = 'http://localhost:8181'

void test('POST /v1/auth/stellar-challenge rejects missing stellarPublicKey', async () => {
  const { url, close } = await startServer()
  try {
    const { status, json } = await postJson(`${url}/v1/auth/stellar-challenge`, { webId: 'https://pod.example.com/alice/profile/card#me' })
    assert.equal(status, 400)
    assert.ok((json as { error: string }).error.includes('stellarPublicKey'))
  } finally {
    await close()
  }
})

void test('POST /v1/auth/stellar-challenge rejects invalid G-key', async () => {
  const { url, close } = await startServer()
  try {
    const { status } = await postJson(`${url}/v1/auth/stellar-challenge`, {
      stellarPublicKey: 'notAGkey',
      webId: 'https://pod.example.com/alice/profile/card#me',
    })
    assert.equal(status, 400)
  } finally {
    await close()
  }
})

void test('POST /v1/auth/stellar-challenge rejects non-https webId', async () => {
  const { url, close } = await startServer()
  const kp = Keypair.random()
  try {
    const { status } = await postJson(`${url}/v1/auth/stellar-challenge`, {
      stellarPublicKey: kp.publicKey(),
      webId: 'http://pod.example.com/alice/profile/card#me',
    })
    assert.equal(status, 400)
  } finally {
    await close()
  }
})

void test('POST /v1/auth/stellar-challenge issues a valid challenge', async () => {
  const { url, close } = await startServer()
  const kp = Keypair.random()
  try {
    const { status, json } = await postJson(`${url}/v1/auth/stellar-challenge`, {
      stellarPublicKey: kp.publicKey(),
      webId: 'https://pod.example.com/alice/profile/card#me',
    })
    assert.equal(status, 200)
    const ch = json as { challengeId: string; nonce: string; stellarPublicKey: string }
    assert.ok(typeof ch.challengeId === 'string' && ch.challengeId.length > 0)
    assert.ok(typeof ch.nonce === 'string' && ch.nonce.length > 0)
    assert.equal(ch.stellarPublicKey, kp.publicKey())
  } finally {
    await close()
  }
})

void test('challenge is single-use: second consume returns 400', async () => {
  const { url, close } = await startServer()
  const kp = Keypair.random()
  const webId = 'https://pod.example.com/bob/profile/card#me'
  try {
    const { json: chJson } = await postJson(`${url}/v1/auth/stellar-challenge`, {
      stellarPublicKey: kp.publicKey(),
      webId,
    })
    const ch = chJson as { challengeId: string; nonce: string }

    const payload = JSON.stringify({ nonce: ch.nonce, stellarPublicKey: kp.publicKey(), audience: 'nz-css-stellar-login-v1' })
    const sig = kp.sign(Buffer.from(payload, 'utf8'))
    const sigB64 = Buffer.from(sig).toString('base64')

    // First token issuance - success
    const { status: s1 } = await postJson(`${url}/v1/auth/stellar-token`, {
      challengeId: ch.challengeId,
      stellarPublicKey: kp.publicKey(),
      signatureBase64: sigB64,
    })
    assert.equal(s1, 200)

    // Second attempt with same challengeId - challenge is gone
    const { status: s2 } = await postJson(`${url}/v1/auth/stellar-token`, {
      challengeId: ch.challengeId,
      stellarPublicKey: kp.publicKey(),
      signatureBase64: sigB64,
    })
    assert.equal(s2, 400)
  } finally {
    await close()
  }
})

void test('POST /v1/auth/stellar-token rejects bad signature', async () => {
  const { url, close } = await startServer()
  const kp = Keypair.random()
  const otherKp = Keypair.random()
  const webId = 'https://pod.example.com/carol/profile/card#me'
  try {
    const { json: chJson } = await postJson(`${url}/v1/auth/stellar-challenge`, {
      stellarPublicKey: kp.publicKey(),
      webId,
    })
    const ch = chJson as { challengeId: string; nonce: string }

    // Sign with the WRONG key
    const payload = JSON.stringify({ nonce: ch.nonce, stellarPublicKey: kp.publicKey(), audience: 'nz-css-stellar-login-v1' })
    const badSig = otherKp.sign(Buffer.from(payload, 'utf8'))
    const { status } = await postJson(`${url}/v1/auth/stellar-token`, {
      challengeId: ch.challengeId,
      stellarPublicKey: kp.publicKey(),
      signatureBase64: Buffer.from(badSig).toString('base64'),
    })
    assert.equal(status, 401)
  } finally {
    await close()
  }
})

void test('full round-trip: challenge → sign → token → verify', async () => {
  const { url, close } = await startServer()
  const kp = Keypair.random()
  const webId = 'https://pod.example.com/dave/profile/card#me'
  try {
    // 1. Get challenge
    const { json: chJson } = await postJson(`${url}/v1/auth/stellar-challenge`, {
      stellarPublicKey: kp.publicKey(),
      webId,
    })
    const ch = chJson as { challengeId: string; nonce: string }

    // 2. Sign challenge payload
    const payload = JSON.stringify({ nonce: ch.nonce, stellarPublicKey: kp.publicKey(), audience: 'nz-css-stellar-login-v1' })
    const sig = kp.sign(Buffer.from(payload, 'utf8'))
    const sigB64 = Buffer.from(sig).toString('base64')

    // 3. Exchange for loginToken
    const { status: tStatus, json: tokenJson } = await postJson(`${url}/v1/auth/stellar-token`, {
      challengeId: ch.challengeId,
      stellarPublicKey: kp.publicKey(),
      signatureBase64: sigB64,
    })
    assert.equal(tStatus, 200)
    const { loginToken } = tokenJson as { loginToken: string; tokenVerifyUrl: string }
    assert.ok(typeof loginToken === 'string' && loginToken.length > 0)

    // 4. Verify token with HMAC auth (as CSS would)
    const audience = 'nz-css-stellar-login-v1'
    const hmac = createHmac('sha256', SHARED_SECRET)
      .update(`${loginToken}:${audience}`)
      .digest('hex')

    const { status: vStatus, json: vJson } = await postJson(
      `${url}/v1/auth/stellar-verify`,
      { token: loginToken, audience },
      { 'x-nz-stellar-auth': hmac },
    )
    assert.equal(vStatus, 200)
    const { valid, webId: returnedWebId } = vJson as { valid: boolean; webId: string }
    assert.equal(valid, true)
    assert.equal(returnedWebId, webId)
  } finally {
    await close()
  }
})

void test('POST /v1/auth/stellar-verify rejects bad HMAC', async () => {
  const { url, close } = await startServer()
  try {
    const { status, json } = await postJson(
      `${url}/v1/auth/stellar-verify`,
      { token: 'some-token-id', audience: 'nz-css-stellar-login-v1' },
      { 'x-nz-stellar-auth': 'badhmacinvalidhex' },
    )
    assert.equal(status, 200)
    assert.equal((json as { valid: boolean }).valid, false)
  } finally {
    await close()
  }
})

void test('POST /v1/auth/stellar-verify is single-use', async () => {
  const { url, close } = await startServer()
  const kp = Keypair.random()
  const webId = 'https://pod.example.com/eve/profile/card#me'
  try {
    const { json: chJson } = await postJson(`${url}/v1/auth/stellar-challenge`, { stellarPublicKey: kp.publicKey(), webId })
    const ch = chJson as { challengeId: string; nonce: string }
    const payload = JSON.stringify({ nonce: ch.nonce, stellarPublicKey: kp.publicKey(), audience: 'nz-css-stellar-login-v1' })
    const sig = kp.sign(Buffer.from(payload, 'utf8'))
    const { json: tokenJson } = await postJson(`${url}/v1/auth/stellar-token`, {
      challengeId: ch.challengeId, stellarPublicKey: kp.publicKey(),
      signatureBase64: Buffer.from(sig).toString('base64'),
    })
    const { loginToken } = tokenJson as { loginToken: string }
    const audience = 'nz-css-stellar-login-v1'
    const hmac = createHmac('sha256', SHARED_SECRET).update(`${loginToken}:${audience}`).digest('hex')

    // First verify — valid
    const { json: v1 } = await postJson(`${url}/v1/auth/stellar-verify`, { token: loginToken, audience }, { 'x-nz-stellar-auth': hmac })
    assert.equal((v1 as { valid: boolean }).valid, true)

    // Second verify — token consumed
    const { json: v2 } = await postJson(`${url}/v1/auth/stellar-verify`, { token: loginToken, audience }, { 'x-nz-stellar-auth': hmac })
    assert.equal((v2 as { valid: boolean }).valid, false)
  } finally {
    await close()
  }
})
