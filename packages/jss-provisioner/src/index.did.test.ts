import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { before, test } from 'node:test'
import type { DidResolutionResult, LockboxLookupFn } from '@nodezero/solid-pod-sync'

process.env.JSS_SOLID_CSS_BASE_URL = 'https://solid.nodezero.social'
process.env.JSS_ISSUER_URL = 'https://staging.nodezero.social'
process.env.JSS_INTERNAL_API_KEY = 'test-internal-key'
process.env.JSS_SESSION_SIGNING_KEY = 'did-route-test-session-key-32b-length!'

const CONTRACT = 'CBFWY2ZF73N5SDH4PQFPR7E5SHWTMMPJOI4ZT675CQLXBYDGNR2VCSPO'
const OWNER_KEY = 'GB7P35TY56RILQHQOEXOHPR6O3OD6I62E4S5L3F3WFF7K332463F7YQI'
const OTHER_KEY = 'GDMJ3GFM2RPB5FRX5DS2IRRSVF6RFYILXZ2WIUIJQJJOHXJTQXOQVBHR'
const OWNER_WEBID = 'https://solid.nodezero.social/alice/profile/card#me'

/** Stands in for the credential-store index: only the real owner's contract resolves. */
const seededLookup: LockboxLookupFn = (contractAddress, network) => {
  if (network !== 'testnet') return Promise.resolve(null)
  if (contractAddress !== CONTRACT) return Promise.resolve(null)
  return Promise.resolve({
    contractAddress,
    stellarPublicKey: OWNER_KEY,
    webId: OWNER_WEBID,
    wakuTopic: `/nodezero-${network}/1/default/proto`,
  })
}

let createRequestHandler: (
  overrides?: Record<string, unknown>
) => (req: IncomingMessage, res: ServerResponse) => void

before(async () => {
  const mod = await import('./index.js')
  createRequestHandler = mod.createRequestHandler
})

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
  overrides: Record<string, unknown> = { didResolverEnabled: true, resolveDidLockbox: seededLookup }
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

void test('GET /v1/did/:did resolves a seeded testnet did:pkn to a W3C DID document', async () => {
  await withServer(async (baseUrl) => {
    const targetDid = `did:pkn:testnet:${CONTRACT}`
    const response = await fetch(`${baseUrl}/v1/did/${targetDid}`)

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/did+ld+json; charset=utf-8')

    const body = (await response.json()) as DidResolutionResult
    assert.equal(body['@context'], 'https://w3id.org/did-resolution/v1')
    assert.ok(body.didDocument)
    assert.equal(body.didDocument?.id, targetDid)
    assert.equal(body.didDocument?.controller, targetDid)
    assert.equal(body.didDocument?.verificationMethod?.[0]?.type, 'Ed25519VerificationKey2020')
  })
})

void test('NC-01: the verification method carries the subject-specific key, not a shared constant', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/did/did:pkn:testnet:${CONTRACT}`)
    const body = (await response.json()) as DidResolutionResult
    const method = body.didDocument?.verificationMethod?.[0]

    assert.equal(method?.stellarAddress, OWNER_KEY)
    assert.notEqual(method?.stellarAddress, OTHER_KEY)
    assert.ok(method?.publicKeyMultibase?.startsWith('z'))
  })
})

void test('NC-01: an unknown contract address does not resolve', async () => {
  await withServer(async (baseUrl) => {
    const unknown = 'CDQKUKF2AB2UIGNMXM2DTE7JDV5OMPRUDBYOW7OVMYXXUK2UTIFVXMIF'
    const response = await fetch(`${baseUrl}/v1/did/did:pkn:testnet:${unknown}`)

    assert.equal(response.status, 404)
    const body = (await response.json()) as DidResolutionResult
    assert.equal(body.didResolutionMetadata.error, 'notFound')
    assert.equal(body.didDocument, null)
  })
})

void test('NC-01: a mainnet identifier does not resolve against testnet state', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/did/did:pkn:mainnet:${CONTRACT}`)

    assert.equal(response.status, 404)
    const body = (await response.json()) as DidResolutionResult
    assert.equal(body.didResolutionMetadata.error, 'notFound')
  })
})

void test('GET /v1/did/resolve with query parameter resolves did:pkn', async () => {
  await withServer(async (baseUrl) => {
    const targetDid = `did:pkn:testnet:${CONTRACT}`
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

void test('the DID resolver is not reachable when disabled', async () => {
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/did/did:pkn:testnet:${CONTRACT}`)
      assert.equal(response.status, 404)
      const body = (await response.json()) as { error?: string }
      assert.equal(body.error, 'Not found.')
    },
    { didResolverEnabled: false }
  )
})
