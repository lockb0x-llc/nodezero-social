import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { before, test } from 'node:test'
import type { DidResolutionResult } from '@nodezero/solid-pod-sync'

process.env.JSS_SOLID_CSS_BASE_URL = 'https://solid.nodezero.social'
process.env.JSS_ISSUER_URL = 'https://staging.nodezero.social'
process.env.JSS_INTERNAL_API_KEY = 'test-internal-key'
process.env.JSS_SESSION_SIGNING_KEY = 'did-route-test-session-key-32b-length!'

let createRequestHandler: (
  overrides?: Record<string, unknown>
) => (req: IncomingMessage, res: ServerResponse) => void

before(async () => {
  const mod = await import('./index.js')
  createRequestHandler = mod.createRequestHandler
})

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
  overrides: Record<string, unknown> = {}
): Promise<T> {
  const server = createServer(createRequestHandler(overrides))
  server.listen(0)
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Server address unavailable')
  }
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    return await fn(baseUrl)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

void test('GET /v1/did/:did resolves a valid testnet did:pkn to a W3C DID document', async () => {
  await withServer(async (baseUrl) => {
    const contractAddress = 'CBFWY2ZF73N5SDH4PQFPR7E5SHWTMMPJOI4ZT675CQLXBYDGNR2VCSPO'
    const targetDid = `did:pkn:testnet:${contractAddress}`
    const response = await fetch(`${baseUrl}/v1/did/${targetDid}`)

    const body = (await response.json()) as DidResolutionResult
    if (response.status !== 200) {
      console.error('Error response body:', body)
    }

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/did+ld+json; charset=utf-8')

    assert.equal(body['@context'], 'https://w3id.org/did-resolution/v1')
    assert.ok(body.didDocument)
    assert.equal(body.didDocument?.id, targetDid)
    assert.equal(body.didDocument?.controller, targetDid)
    assert.ok(body.didDocument?.verificationMethod)
    assert.equal(body.didDocument?.verificationMethod?.[0]?.type, 'Ed25519VerificationKey2020')
    assert.ok(body.didDocument?.service)
    assert.ok(body.didDocument?.service?.length ?? 0 >= 2)
  })
})

void test('GET /v1/did/resolve with query parameter resolves did:pkn', async () => {
  await withServer(async (baseUrl) => {
    const contractAddress = 'CBFWY2ZF73N5SDH4PQFPR7E5SHWTMMPJOI4ZT675CQLXBYDGNR2VCSPO'
    const targetDid = `did:pkn:testnet:${contractAddress}`
    const response = await fetch(`${baseUrl}/v1/did/resolve?did=${encodeURIComponent(targetDid)}`)

    assert.equal(response.status, 200)
    const body = (await response.json()) as DidResolutionResult
    assert.equal(body.didDocument?.id, targetDid)
  })
})

void test('GET /v1/did/:did rejects invalid DID formats with 400', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/did/did:invalid:not-pkn`)

    assert.equal(response.status, 400)
    const body = (await response.json()) as DidResolutionResult
    assert.equal(body.didResolutionMetadata.error, 'invalidDid')
    assert.equal(body.didDocument, null)
  })
})
