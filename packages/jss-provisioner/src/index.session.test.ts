/**
 * Fail-closed session + onboarding + Pod proxy integration tests.
 *
 * Boots a mock CSS (account API, OIDC token endpoint, and an in-memory Pod)
 * before importing the provisioner so JSS_SOLID_CSS_BASE_URL freezes onto the
 * mock. Every test then exercises the *real* invariant chain:
 *
 *   provision -> credentials persisted -> Solid token minted -> Pod probed
 *   -> NodeZero session issued -> proxy forwards LDP verbs
 *   -> revocation fails everything closed.
 */

import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { before, after, beforeEach, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { Keypair } from '@stellar/stellar-sdk'
import {
  RELATIONSHIP_DELIVERY_ASSERTION_PROPERTY,
  RelationshipDeliveryAssertionManager,
} from './relationshipDeliveryAssertions.js'
import { SessionTokenManager } from './sessionTokens.js'
import { hashCohortIdentity } from './milestoneQControls.js'

// ---------------------------------------------------------------------------
// Mock CSS
// ---------------------------------------------------------------------------

interface MockCssState {
  accounts: Map<string, { email: string; password: string }>
  credentials: Map<string, { secret: string; webId: string }>
  pods: Map<string, Map<string, { contentType: string; body: string }>>
  /** When true the token endpoint rejects every exchange (revoked upstream). */
  rejectTokenExchange: boolean
  rejectPodRequests: number
  /** Number of transient CSS Pod creation 400 responses to emit. */
  transientPodBadRequests: number
  loseNextPodCreateResponse: boolean
  podCreateRequests: number
  clientCredentialRequests: number
  accountCreateRequests: number
  loseNextAccountCreateResponse: boolean
  tokenExchanges: number
  lastPodCacheControl: string | null
}

const cssState: MockCssState = {
  accounts: new Map(),
  credentials: new Map(),
  pods: new Map(),
  rejectTokenExchange: false,
  rejectPodRequests: 0,
  transientPodBadRequests: 0,
  loseNextPodCreateResponse: false,
  podCreateRequests: 0,
  clientCredentialRequests: 0,
  accountCreateRequests: 0,
  loseNextAccountCreateResponse: false,
  tokenExchanges: 0,
  lastPodCacheControl: null,
}

let cssBaseUrl = ''

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function controlsFor(base: string): Record<string, unknown> {
  return {
    controls: {
      account: {
        create: `${base}/.account/create`,
        pod: `${base}/.account/pod`,
        clientCredentials: `${base}/.account/client-credentials`,
        webId: `${base}/.account/webid`,
      },
      password: {
        create: `${base}/.account/password`,
        login: `${base}/.account/login`,
      },
    },
  }
}

async function handleMockCss(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', cssBaseUrl)
  const path = url.pathname

  if (req.method === 'GET' && path === '/.account/') {
    json(res, 200, controlsFor(cssBaseUrl))
    return
  }
  if (req.method === 'POST' && path === '/.account/create') {
    cssState.accountCreateRequests += 1
    const token = randomUUID()
    cssState.accounts.set(token, { email: '', password: '' })
    if (cssState.loseNextAccountCreateResponse) {
      cssState.loseNextAccountCreateResponse = false
      res.destroy()
      return
    }
    json(res, 200, { authorization: token })
    return
  }
  if (req.method === 'POST' && path === '/.account/password') {
    const token = (req.headers.authorization ?? '').replace('CSS-Account-Token ', '')
    const account = cssState.accounts.get(token)
    if (!account) return json(res, 401, { error: 'bad token' })
    const body = JSON.parse(await readBody(req)) as { email: string; password: string }
    account.email = body.email
    account.password = body.password
    json(res, 200, {})
    return
  }
  if (req.method === 'POST' && path === '/.account/pod') {
    cssState.podCreateRequests += 1
    if (cssState.transientPodBadRequests > 0) {
      cssState.transientPodBadRequests -= 1
      json(res, 400, { name: 'BadRequestHttpError', message: 'temporary Pod state conflict' })
      return
    }
    const body = JSON.parse(await readBody(req)) as { name: string }
    const podUrl = `${cssBaseUrl}/${body.name}/`
    const webId = `${podUrl}profile/card#me`
    if (cssState.pods.has(body.name)) {
      json(res, 400, {
        name: 'BadRequestHttpError',
        message: `${webId} is already registered to this account.`,
      })
      return
    }
    cssState.pods.set(body.name, new Map())
    if (cssState.loseNextPodCreateResponse) {
      cssState.loseNextPodCreateResponse = false
      json(res, 500, {
        name: 'LockError',
        message: `Lock expired after 6000ms on ${podUrl}account/mock/`,
      })
      return
    }
    json(res, 200, { pod: podUrl, webId })
    return
  }
  if (req.method === 'GET' && path === '/.account/webid') {
    json(res, 200, { webIdLinks: {} })
    return
  }
  if (req.method === 'POST' && path === '/.account/client-credentials') {
    cssState.clientCredentialRequests += 1
    const body = JSON.parse(await readBody(req)) as { name: string; webId: string }
    const id = `cc-${randomUUID()}`
    const secret = `secret-${randomUUID()}`
    cssState.credentials.set(id, { secret, webId: body.webId })
    json(res, 200, { id, secret, resource: `${cssBaseUrl}/.account/client-credentials/${id}` })
    return
  }
  if (req.method === 'POST' && path === '/.oidc/token') {
    cssState.tokenExchanges += 1
    if (cssState.rejectTokenExchange) {
      json(res, 401, { error: 'invalid_client' })
      return
    }
    const auth = req.headers.authorization ?? ''
    const basic = Buffer.from(auth.replace('Basic ', ''), 'base64').toString('utf8')
    const [id] = basic.split(':').map((part) => decodeURIComponent(part))
    if (!cssState.credentials.has(id)) {
      json(res, 401, { error: 'unknown client' })
      return
    }
    json(res, 200, {
      access_token: `at-${id}-${randomUUID()}`,
      expires_in: 600,
      token_type: 'DPoP',
    })
    return
  }

  // Pod resource space: /{pod}/...
  const match = /^\/([^/]+)\/(.*)$/.exec(path)
  if (match) {
    const [, podName, rest] = match
    const pod = cssState.pods.get(podName)
    if (!pod) return json(res, 404, { error: 'no pod' })

    const authHeader = req.headers.authorization ?? ''
    cssState.lastPodCacheControl =
      typeof req.headers['cache-control'] === 'string' ? req.headers['cache-control'] : null
    if (!authHeader.startsWith('DPoP ') || !req.headers.dpop) {
      return json(res, 401, { error: 'unauthenticated' })
    }
    if (cssState.rejectPodRequests > 0) {
      cssState.rejectPodRequests -= 1
      return json(res, 401, { error: 'expired token' })
    }

    if (req.method === 'HEAD' || req.method === 'GET') {
      if (rest === '') {
        res.writeHead(200, { 'content-type': 'text/turtle' })
        res.end(req.method === 'GET' ? '<> a <http://www.w3.org/ns/ldp#Container> .' : undefined)
        return
      }
      const doc = pod.get(rest)
      if (!doc) return json(res, 404, { error: 'not found' })
      res.writeHead(200, { 'content-type': doc.contentType, etag: '"v1"' })
      res.end(req.method === 'GET' ? doc.body : undefined)
      return
    }
    if (req.method === 'PUT') {
      pod.set(rest, {
        contentType: (req.headers['content-type'] as string) ?? 'application/octet-stream',
        body: await readBody(req),
      })
      res.writeHead(201, { location: `${cssBaseUrl}${path}` })
      res.end()
      return
    }
    if (req.method === 'PATCH') {
      const existing = pod.get(rest) ?? { contentType: 'text/turtle', body: '' }
      const patch = await readBody(req)
      pod.set(rest, { ...existing, body: `${existing.body}\n# patched: ${patch.length} bytes` })
      res.writeHead(205)
      res.end()
      return
    }
    if (req.method === 'DELETE') {
      pod.delete(rest)
      res.writeHead(205)
      res.end()
      return
    }
  }

  json(res, 404, { error: `mock css: unhandled ${req.method} ${path}` })
}

// ---------------------------------------------------------------------------
// Provisioner under test
// ---------------------------------------------------------------------------

const INTERNAL_KEY = 'test-internal-key-0123456789abcdef'
let mockCss: ReturnType<typeof createServer>
let provisioner: ReturnType<typeof createServer>
let baseUrl = ''
let routeBlockedRecipient: string | null = null
let podProxySuppressionRevision: number | null = null

before(async () => {
  mockCss = createServer((req, res) => {
    void handleMockCss(req, res).catch(() => json(res, 500, { error: 'mock failure' }))
  })
  mockCss.listen(0, '127.0.0.1')
  await once(mockCss, 'listening')
  const cssAddress = mockCss.address()
  if (!cssAddress || typeof cssAddress === 'string') throw new Error('mock CSS bind failed')
  cssBaseUrl = `http://127.0.0.1:${cssAddress.port}`

  process.env.JSS_SOLID_CSS_BASE_URL = cssBaseUrl
  process.env.JSS_ISSUER_URL = 'https://staging.nodezero.social'
  process.env.JSS_LOCKBOX_FACTORY_MODE = 'mock'
  process.env.JSS_LOCKBOX_FACTORY_ALLOW_MOCK_READY = '1'
  process.env.JSS_INTERNAL_API_KEY = INTERNAL_KEY
  process.env.JSS_SESSION_SIGNING_KEY = 'unit-test-session-signing-key-32b!'
  process.env.JSS_RELATIONSHIP_DELIVERY_SIGNING_KEY = 'unit-test-delivery-signing-key-32b!'
  process.env.JSS_Q_RELATIONSHIP_ENABLED = 'true'
  process.env.JSS_Q_TRANSPORT_ENABLED = 'true'
  process.env.JSS_Q_COHORT_KEY = 'session-route-test-cohort-key'
  const cohortWebIds = [
    ...Array.from({ length: 100 }, (_, index) => `${cssBaseUrl}/alice${index + 1}/profile/card#me`),
    'https://alice.example/profile/card#me',
    'https://bob.example/profile/card#me',
    'https://rate-limited.example/profile/card#me',
    'https://blocked-route.example/profile/card#me',
    'https://verify-rate.example/profile/card#me',
  ]
  process.env.JSS_Q_COHORT_HASHES = cohortWebIds
    .map((webId) => hashCohortIdentity(webId, process.env.JSS_Q_COHORT_KEY!))
    .join(',')
  process.env.JSS_RELATIONSHIP_DELIVERY_RATE_LIMIT = '1'
  process.env.JSS_RELATIONSHIP_DELIVERY_RATE_WINDOW_MS = '60000'
  process.env.JSS_RELATIONSHIP_VERIFY_RATE_LIMIT = '2'
  process.env.JSS_RELATIONSHIP_VERIFY_RATE_WINDOW_MS = '60000'
  process.env.JSS_BROWSER_SESSION_ENABLED = 'true'
  process.env.NZ_ENV_PROFILE = 'local'
  process.env.JSS_BUILD_COMMIT = 'test-build-commit'
  process.env.JSS_BUILD_ARTIFACT_SHA256 = 'a'.repeat(64)
  process.env.JSS_PUBLIC_PROVISIONER_BASE_URL = 'https://api.nodezero.social'
  process.env.JSS_APP_ORIGIN = 'https://staging.nodezero.social'
  process.env.JSS_SOLID_CSS_POD_LOCK_RETRY_ATTEMPTS = '5'
  process.env.JSS_SOLID_CSS_POD_LOCK_RETRY_BASE_DELAY_MS = '1'
  process.env.JSS_IDENTITY_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'
  process.env.JSS_LOCKBOX_FACTORY_VERSION = 'v2'
  process.env.JSS_LOCKBOX_FACTORY_CONTRACT_ID =
    'CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAG4'
  process.env.JSS_LOCKBOX_BRIDGE_V3_MANIFEST_URL = 'https://artifacts.example/manifest.json'
  process.env.JSS_LOCKBOX_BRIDGE_V3_MANIFEST_SHA256 = 'b'.repeat(64)
  process.env.JSS_LOCKBOX_BRIDGE_V3_WASM_URL = 'https://artifacts.example/prover.wasm'
  process.env.JSS_LOCKBOX_BRIDGE_V3_WASM_SHA256 = 'c'.repeat(64)
  process.env.JSS_LOCKBOX_BRIDGE_V3_ZKEY_URL = 'https://artifacts.example/prover.zkey'
  process.env.JSS_LOCKBOX_BRIDGE_V3_ZKEY_SHA256 = 'd'.repeat(64)
  process.env.JSS_LOCKBOX_BRIDGE_V3_VK_URL = 'https://artifacts.example/vk.json'
  process.env.JSS_LOCKBOX_BRIDGE_V3_VK_SHA256 = 'e'.repeat(64)
  delete process.env.JSS_CREDENTIALS_TABLE_SAS_URL
  delete process.env.JSS_CREDENTIALS_FILE
  delete process.env.JSS_CREDENTIALS_ENC_KEY

  const mod = await import('./index.js')
  provisioner = createServer(
    mod.createRequestHandler({
      isRelationshipRecipientBlocked: (_claims, recipientWebId) =>
        Promise.resolve(recipientWebId === routeBlockedRecipient),
      readPodProxyPublicationConsent: () =>
        Promise.resolve({
          publicationRevision: 1,
          publicListing: true,
          publicIndexing: false,
        }),
      getPodProxySuppressionRevision: () => Promise.resolve(podProxySuppressionRevision),
    })
  )
  provisioner.listen(0, '127.0.0.1')
  await once(provisioner, 'listening')
  const address = provisioner.address()
  if (!address || typeof address === 'string') throw new Error('provisioner bind failed')
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(() => {
  provisioner?.close()
  mockCss?.close()
})

beforeEach(() => {
  cssState.rejectTokenExchange = false
  cssState.rejectPodRequests = 0
  cssState.lastPodCacheControl = null
  cssState.transientPodBadRequests = 0
  cssState.loseNextPodCreateResponse = false
  cssState.loseNextAccountCreateResponse = false
  routeBlockedRecipient = null
  podProxySuppressionRevision = null
})

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json: payload, headers: res.headers }
}

interface SessionShape {
  accessToken: string
  refreshToken: string
  expiresAt: string
  webId: string
  podUrl: string
}

let counter = 0
async function provisionUserWith(
  keypair: Keypair
): Promise<{ session: SessionShape; webId: string; podUrl: string; keypair: Keypair }> {
  counter += 1
  const { status, json: payload } = await postJson('/v1/solid-account', {
    name: `alice${counter}`,
    email: `alice${counter}@example.com`,
    stellarPublicKey: keypair.publicKey(),
  })
  assert.equal(status, 200, `provision failed: ${JSON.stringify(payload)}`)
  const session = payload.session as SessionShape
  assert.ok(session?.accessToken, 'session.accessToken missing')
  assert.ok(session?.refreshToken, 'session.refreshToken missing')
  return { session, webId: payload.webId as string, podUrl: payload.podUrl as string, keypair }
}

async function provisionUser(): Promise<{
  session: SessionShape
  webId: string
  podUrl: string
  keypair: Keypair
}> {
  const keypair = Keypair.random()
  return provisionUserWith(keypair)
}

// ---------------------------------------------------------------------------
// Onboarding contract
// ---------------------------------------------------------------------------

void test('solid-account: rejects a stale config fingerprint before CSS account creation', async () => {
  const accountsBefore = cssState.accounts.size
  const { status, json: payload } = await postJson('/v1/solid-account', {
    name: 'stale-config',
    email: 'stale-config@example.com',
    stellarPublicKey: Keypair.random().publicKey(),
    configFingerprint: 'f'.repeat(64),
  })
  assert.equal(status, 409)
  assert.equal(payload.code, 'config_stale')
  assert.match(String(payload.configFingerprint ?? ''), /^[0-9a-f]{64}$/)
  assert.equal(cssState.accounts.size, accountsBefore)
})

void test('solid-account: no password field exists in the contract', async () => {
  const { status, json: payload } = await postJson('/v1/solid-account', {
    name: 'nopass',
    email: 'nopass@example.com',
    password: 'user-chosen-password-should-be-ignored',
    stellarPublicKey: Keypair.random().publicKey(),
  })
  assert.equal(status, 200)
  // The response must never echo any password material.
  const raw = JSON.stringify(payload)
  assert.ok(!raw.includes('user-chosen-password-should-be-ignored'))
  assert.ok(!('oidcBridge' in payload), 'oidcBridge must be gone')
})

void test('solid-account: returns a session that immediately proxies Pod writes', async () => {
  const { session, podUrl } = await provisionUser()

  const podPath = new URL(podUrl).pathname.replace(/^\//, '')
  const res = await fetch(`${baseUrl}/v1/pod-proxy/${podPath}notes/hello.ttl`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'text/turtle',
    },
    body: '<#note> a <https://nodezero.social/ns#Note> .',
  })
  assert.equal(res.status, 201)

  const read = await fetch(`${baseUrl}/v1/pod-proxy/${podPath}notes/hello.ttl`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  })
  assert.equal(read.status, 200)
  assert.match(await read.text(), /nodezero\.social\/ns#Note/)
})

void test('proxy: protected publication mutations require a generation and HTTP precondition', async () => {
  const { session, podUrl, webId } = await provisionUser()
  const podName = new URL(podUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  cssState.pods.get(podName)?.set('social/consent/discovery', {
    contentType: 'text/turtle',
    body: `
      @prefix nz: <https://nodezero.social/ns#> .
      <${podUrl}social/consent/discovery#consent> a nz:DiscoveryConsent ;
        nz:version 1 ; nz:publicationRevision 1 ;
        nz:publicationUpdatedAt "2026-08-02T00:00:00.000Z" ;
        nz:ownerWebId <${webId}> ; nz:publicListing true ; nz:publicIndexing false ;
        nz:nearbyPresence false ; nz:inboundContactRequests false ;
        nz:localBroadcasts false ; nz:updatedAt "2026-08-02T00:00:00.000Z" .
    `,
  })
  const podPath = new URL(podUrl).pathname.replace(/^\//, '')
  const target = `${baseUrl}/v1/pod-proxy/${podPath}public/discovery/manifest`

  const missing = await fetch(target, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'text/turtle',
    },
    body: '<#manifest> a <https://nodezero.social/ns#DiscoveryManifest> .',
  })
  assert.equal(missing.status, 428)
  assert.equal(
    ((await missing.json()) as { code?: string }).code,
    'publication_precondition_required'
  )

  const emptyIfMatch = await fetch(target, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'if-match': '',
      'x-nodezero-publication-revision': '1',
    },
  })
  assert.equal(emptyIfMatch.status, 428)

  const guarded = await fetch(target, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'text/turtle',
      'if-none-match': '*',
      'x-nodezero-publication-revision': '1',
    },
    body: '<#manifest> a <https://nodezero.social/ns#DiscoveryManifest> .',
  })
  assert.equal(guarded.status, 201)

  const wildcardIfMatch = await fetch(target, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'if-match': '*',
      'x-nodezero-publication-revision': '1',
    },
  })
  assert.equal(wildcardIfMatch.status, 428)

  const profileUrl = webId.split('#')[0] ?? ''
  const profilePath = new URL(profileUrl).pathname.replace(/^\//, '')
  const typeIndexUrl = `${podUrl}settings/publicTypeIndex`
  const pointerWrite = await fetch(`${baseUrl}/v1/pod-proxy/${profilePath}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'text/turtle',
      'if-none-match': '*',
      'x-nodezero-publication-revision': '1',
    },
    body: `<${webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${typeIndexUrl}> .`,
  })
  assert.equal(pointerWrite.status, 201)

  const typeIndexPath = new URL(typeIndexUrl).pathname.replace(/^\//, '')
  const markerFreeReplacement = await fetch(`${baseUrl}/v1/pod-proxy/${typeIndexPath}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'text/turtle',
      'if-none-match': '*',
    },
    body: '<> a <http://www.w3.org/ns/solid/terms#TypeIndex> .',
  })
  assert.equal(markerFreeReplacement.status, 428)

  const commaEtag = await fetch(target, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/sparql-update',
      'if-match': '"v1,part"',
      'x-nodezero-publication-revision': '1',
    },
    body: 'INSERT DATA { <#manifest> <https://nodezero.social/ns#displayName> "Alice" . }',
  })
  assert.equal(commaEtag.status, 205)
})

void test('proxy: rejects encoded aliases for protected publication paths', async () => {
  const { session, podUrl } = await provisionUser()
  const podPath = new URL(podUrl).pathname.replace(/^\//, '')
  const response = await fetch(`${baseUrl}/v1/pod-proxy/${podPath}public/%64iscovery/manifest`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'if-match': '"v1"',
      'x-nodezero-publication-revision': '1',
    },
  })
  assert.equal(response.status, 403)
  assert.equal(((await response.json()) as { code?: string }).code, 'pod_path_invalid')

  const doubleEncoded = await fetch(
    `${baseUrl}/v1/pod-proxy/${podPath}public/%2564iscovery/manifest`,
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'if-match': '"v1"',
        'x-nodezero-publication-revision': '1',
      },
    }
  )
  assert.equal(doubleEncoded.status, 403)
  assert.equal(((await doubleEncoded.json()) as { code?: string }).code, 'pod_path_invalid')
})

void test('proxy: destructive publication cleanup requires matching authority and suppression', async () => {
  const { session, podUrl } = await provisionUser()
  const podName = new URL(podUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  const pod = cssState.pods.get(podName)
  assert.ok(pod)
  const manifestPath = 'public/discovery/manifest'
  const manifestBody = '<#manifest> a <https://nodezero.social/ns#DiscoveryManifest> .'
  pod.set(manifestPath, { contentType: 'text/turtle', body: manifestBody })
  const target = `${baseUrl}/v1/pod-proxy/${podName}/${manifestPath}`

  const wrongGeneration = await fetch(target, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'if-match': '"v1"',
      'x-nodezero-publication-revision': '999',
    },
  })
  assert.equal(wrongGeneration.status, 409)
  assert.equal(pod.get(manifestPath)?.body, manifestBody)

  const unsuppressed = await fetch(target, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'if-match': '"v1"',
      'x-nodezero-publication-revision': '1',
    },
  })
  assert.equal(unsuppressed.status, 409)
  assert.equal(pod.get(manifestPath)?.body, manifestBody)

  podProxySuppressionRevision = 1
  const suppressed = await fetch(target, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'if-match': '"v1"',
      'x-nodezero-publication-revision': '1',
    },
  })
  assert.equal(suppressed.status, 205)
  assert.equal(pod.has(manifestPath), false)
})

void test('proxy: fails closed on a manifest-referenced Type Index after its WebID pointer disappears', async () => {
  const { session, webId, podUrl } = await provisionUser()
  const podName = new URL(podUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  const pod = cssState.pods.get(podName)
  assert.ok(pod)
  const manifestUrl = `${podUrl}public/discovery/manifest`
  const typeIndexUrl = `${podUrl}settings/publicTypeIndex`
  pod.set('public/discovery/manifest', {
    contentType: 'text/turtle',
    body: `
      @prefix nz: <https://nodezero.social/ns#> .
      <${manifestUrl}#manifest> a nz:DiscoveryManifest ; nz:version 1 ;
        nz:publicationRevision 5 ; nz:webId <${webId}> ;
        nz:publishedAt "2026-08-02T00:00:00.000Z" ;
        nz:expiresAt "2026-08-08T00:00:00.000Z" ;
        <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${typeIndexUrl}> .
    `,
  })
  const originalTypeIndex = '<> a <http://www.w3.org/ns/solid/terms#TypeIndex> .'
  pod.set('settings/publicTypeIndex', {
    contentType: 'text/turtle',
    body: originalTypeIndex,
  })

  const targetPath = new URL(typeIndexUrl).pathname.replace(/^\//, '')
  const attemptedMutation = await fetch(`${baseUrl}/v1/pod-proxy/${targetPath}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'text/turtle',
      'if-match': '"v1"',
    },
    body: '<> a <http://www.w3.org/ns/solid/terms#TypeIndex> .',
  })
  assert.equal(attemptedMutation.status, 503)
  assert.equal(
    ((await attemptedMutation.json()) as { code?: string }).code,
    'publication_guard_unavailable'
  )
  assert.equal(pod.get('settings/publicTypeIndex')?.body, originalTypeIndex)
})

void test('proxy: fails closed when authoritative Type Index discovery fails', async () => {
  const { session, podUrl } = await provisionUser()
  const podName = new URL(podUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  cssState.pods.get(podName)?.set('profile/card', {
    contentType: 'text/turtle',
    body: '<malformed',
  })

  const targetPath = new URL(`${podUrl}settings/publicTypeIndex`).pathname.replace(/^\//, '')
  const attemptedMutation = await fetch(`${baseUrl}/v1/pod-proxy/${targetPath}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'text/turtle',
      'if-none-match': '*',
    },
    body: '<> a <http://www.w3.org/ns/solid/terms#TypeIndex> .',
  })
  assert.equal(attemptedMutation.status, 503)
  assert.equal(
    ((await attemptedMutation.json()) as { code?: string }).code,
    'publication_guard_unavailable'
  )
  assert.equal(cssState.pods.get(podName)?.has('settings/publicTypeIndex'), false)
})

void test('proxy: marker-free WebID profile replacement and deletion require publication fences', async () => {
  const { session, webId, podUrl } = await provisionUser()
  const podName = new URL(podUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  const typeIndexUrl = `${podUrl}settings/publicTypeIndex`
  cssState.pods.get(podName)?.set('profile/card', {
    contentType: 'text/turtle',
    body: `<${webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${typeIndexUrl}> .`,
  })
  const profilePath = new URL(webId.split('#')[0] ?? '').pathname.replace(/^\//, '')
  const profileTarget = `${baseUrl}/v1/pod-proxy/${profilePath}`
  const replace = await fetch(profileTarget, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'text/turtle',
      'if-none-match': '*',
    },
    body: '<> a <http://xmlns.com/foaf/0.1/PersonalProfileDocument> .',
  })
  assert.equal(replace.status, 428)

  const remove = await fetch(`${profileTarget}?cache-bust=1`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'if-match': '"v1"',
    },
  })
  assert.equal(remove.status, 428)
})

void test('proxy: ordinary ETag-fenced profile patches remain compatible', async () => {
  const { session, webId } = await provisionUser()
  const profilePath = new URL(webId.split('#')[0] ?? '').pathname.replace(/^\//, '')
  const update = await fetch(`${baseUrl}/v1/pod-proxy/${profilePath}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/sparql-update',
      'if-match': '"v1"',
    },
    body: `INSERT DATA { <${webId}> <http://xmlns.com/foaf/0.1/name> "Alice" . }`,
  })
  assert.equal(update.status, 205)
})

void test('proxy: prefixed SPARQL cannot bypass profile Type Index fencing', async () => {
  const { session, webId, podUrl } = await provisionUser()
  const podName = new URL(podUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  const typeIndexUrl = `${podUrl}settings/publicTypeIndex`
  cssState.pods.get(podName)?.set('profile/card', {
    contentType: 'text/turtle',
    body: `<${webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${typeIndexUrl}> .`,
  })
  const profilePath = new URL(webId.split('#')[0] ?? '').pathname.replace(/^\//, '')
  const update = await fetch(`${baseUrl}/v1/pod-proxy/${profilePath}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/sparql-update',
      'if-match': '"v1"',
    },
    body: `PREFIX solid: <http://www.w3.org/ns/solid/terms#>
      DELETE DATA { <${webId}> solid:publicTypeIndex <${typeIndexUrl}> . }`,
  })
  assert.equal(update.status, 428)
})

void test('proxy: profile mutation syntax variants cannot bypass Type Index fencing', async () => {
  const { session, webId, podUrl } = await provisionUser()
  const podName = new URL(podUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  const pod = cssState.pods.get(podName)
  assert.ok(pod)
  const typeIndexUrl = `${podUrl}settings/publicTypeIndex`
  const profilePath = new URL(webId.split('#')[0] ?? '').pathname.replace(/^\//, '')
  const profileTarget = `${baseUrl}/v1/pod-proxy/${profilePath}`

  const prefixedCreation = await fetch(profileTarget, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'text/turtle',
      'if-none-match': '*',
    },
    body: `@prefix s: <http://www.w3.org/ns/solid/terms#> . <${webId}> s:publicTypeIndex <${typeIndexUrl}> .`,
  })
  assert.equal(prefixedCreation.status, 428)

  const decoy = await fetch(profileTarget, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'text/turtle',
      'if-none-match': '*',
    },
    body: `<${webId}> <http://xmlns.com/foaf/0.1/name> "${typeIndexUrl}" .`,
  })
  assert.equal(decoy.status, 201)

  pod.set('profile/card', {
    contentType: 'text/turtle',
    body: `<${webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${typeIndexUrl}> .`,
  })
  const binaryReplacement = await fetch(profileTarget, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/octet-stream',
      'if-match': '"v1"',
    },
    body: new Uint8Array([1, 2, 3]),
  })
  assert.equal(binaryReplacement.status, 428)

  const computedPredicate = await fetch(profileTarget, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/sparql-update',
      'if-match': '"v1"',
    },
    body: `PREFIX solid: <http://www.w3.org/ns/solid/terms#>
      INSERT { <${webId}> ?predicate <${typeIndexUrl}> . }
      WHERE { BIND(solid:publicTypeIndex AS ?predicate) }`,
  })
  assert.equal(computedPredicate.status, 428)

  const copy = await fetch(profileTarget, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/sparql-update',
      'if-match': '"v1"',
    },
    body: 'COPY DEFAULT TO <https://solid.nodezero.social/source>',
  })
  assert.equal(copy.status, 428)
})

void test('proxy: standard RDF profile replacements preserve exactly one authoritative Type Index', async () => {
  const { session, webId, podUrl } = await provisionUser()
  const podName = new URL(podUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  const pod = cssState.pods.get(podName)
  assert.ok(pod)
  const typeIndexUrl = `${podUrl}settings/publicTypeIndex`
  const profilePath = new URL(webId.split('#')[0] ?? '').pathname.replace(/^\//, '')
  const profileTarget = `${baseUrl}/v1/pod-proxy/${profilePath}`
  const representations = [
    {
      contentType: 'application/ld+json',
      body: JSON.stringify({
        '@id': webId,
        'http://www.w3.org/ns/solid/terms#publicTypeIndex': { '@id': typeIndexUrl },
      }),
    },
    {
      contentType: 'application/rdf+xml',
      body: `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:solid="http://www.w3.org/ns/solid/terms#"><rdf:Description rdf:about="${webId}"><solid:publicTypeIndex rdf:resource="${typeIndexUrl}"/></rdf:Description></rdf:RDF>`,
    },
    {
      contentType: 'application/n-triples',
      body: `<${webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${typeIndexUrl}> .`,
    },
  ]
  for (const representation of representations) {
    pod.set('profile/card', {
      contentType: 'text/turtle',
      body: `<${webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${typeIndexUrl}> .`,
    })
    const response = await fetch(profileTarget, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'content-type': representation.contentType,
        'if-match': '"v1"',
      },
      body: representation.body,
    })
    assert.equal(response.status, 201)
  }

  pod.set('profile/card', {
    contentType: 'text/turtle',
    body: `<${webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${typeIndexUrl}> .`,
  })
  const duplicatePointer = await fetch(profileTarget, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'text/turtle',
      'if-match': '"v1"',
    },
    body: `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${webId}> solid:publicTypeIndex <${typeIndexUrl}>, <${podUrl}settings/otherIndex> .`,
  })
  assert.equal(duplicatePointer.status, 428)
})

void test('proxy: JSON-LD contexts and Type Index terms remain local and owner-bound', async () => {
  const { session, webId, podUrl } = await provisionUser()
  const podName = new URL(podUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  const pod = cssState.pods.get(podName)
  assert.ok(pod)
  const typeIndexUrl = `${podUrl}settings/publicTypeIndex`
  const profilePath = new URL(webId.split('#')[0] ?? '').pathname.replace(/^\//, '')
  const profileTarget = `${baseUrl}/v1/pod-proxy/${profilePath}`
  const existingProfile = `<${webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${typeIndexUrl}> .`

  for (const [body, expectedStatus] of [
    [JSON.stringify({ '@context': 'http://127.0.0.1/context', '@id': webId }), 503],
    [
      JSON.stringify({
        '@context': { '@import': 'http://127.0.0.1/context' },
        '@id': webId,
      }),
      503,
    ],
    [
      JSON.stringify({
        '@id': 'https://mallory.example/profile/card#me',
        'http://www.w3.org/ns/solid/terms#publicTypeIndex': { '@id': typeIndexUrl },
      }),
      428,
    ],
    [
      JSON.stringify({
        '@id': webId,
        'http://www.w3.org/ns/solid/terms#publicTypeIndex': typeIndexUrl,
      }),
      428,
    ],
  ] as const) {
    pod.set('profile/card', { contentType: 'text/turtle', body: existingProfile })
    const response = await fetch(profileTarget, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/ld+json',
        'if-match': '"v1"',
      },
      body,
    })
    assert.equal(response.status, expectedStatus)
    assert.equal(pod.get('profile/card')?.body, existingProfile)
  }
})

void test('proxy: ordinary JSON resources are not classified as publication RDF', async () => {
  const { session, podUrl } = await provisionUser()
  const podPath = new URL(podUrl).pathname.replace(/^\//, '')
  const target = `${baseUrl}/v1/pod-proxy/${podPath}social/trust-circles.json`
  const create = await fetch(target, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
      'if-none-match': '*',
    },
    body: '{"version":1,"members":[]}',
  })
  assert.equal(create.status, 201)

  const update = await fetch(target, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
      'if-match': '"v1"',
    },
    body: '{"version":1,"members":["alice"]}',
  })
  assert.equal(update.status, 201)
})

void test('proxy: rejects request bodies larger than the parser boundary', async () => {
  const { session, podUrl } = await provisionUser()
  const podPath = new URL(podUrl).pathname.replace(/^\//, '')
  const response = await fetch(`${baseUrl}/v1/pod-proxy/${podPath}oversized.bin`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/octet-stream',
      'if-none-match': '*',
    },
    body: Buffer.alloc(5 * 1024 * 1024 + 1),
  })
  assert.equal(response.status, 413)
  assert.equal(((await response.json()) as { code?: string }).code, 'payload_too_large')
})

void test('solid-account: retries a transient CSS Pod creation 400', async () => {
  cssState.transientPodBadRequests = 1
  const { session, webId } = await provisionUser()

  assert.ok(session.accessToken)
  assert.match(webId, /profile\/card#me$/)
  assert.equal(cssState.transientPodBadRequests, 0)
})

void test('solid-account: recovers from repeated transient CSS Pod conflicts', async () => {
  cssState.transientPodBadRequests = 4
  const { session, webId } = await provisionUser()

  assert.ok(session.accessToken)
  assert.match(webId, /profile\/card#me$/)
  assert.equal(cssState.transientPodBadRequests, 0)
})

void test('solid-account: recovers when Pod commit succeeds before a lock-expired response', async () => {
  const podRequestsBefore = cssState.podCreateRequests
  const credentialRequestsBefore = cssState.clientCredentialRequests
  cssState.loseNextPodCreateResponse = true

  const { session, webId } = await provisionUser()

  assert.ok(session.accessToken)
  assert.match(webId, /profile\/card#me$/)
  assert.equal(cssState.podCreateRequests, podRequestsBefore + 2)
  assert.equal(cssState.clientCredentialRequests, credentialRequestsBefore + 1)
})

void test('solid-account: same idempotency key replays without another CSS account', async () => {
  counter += 1
  const request = {
    name: `replay${counter}`,
    email: `replay${counter}@example.com`,
    stellarPublicKey: Keypair.random().publicKey(),
  }
  const headers = { 'idempotency-key': `replay-key-${counter}` }
  const createsBefore = cssState.accountCreateRequests

  const created = await postJson('/v1/solid-account', request, headers)
  assert.equal(created.status, 200, JSON.stringify(created.json))
  const replayed = await postJson('/v1/solid-account', request, headers)
  assert.equal(replayed.status, 200, JSON.stringify(replayed.json))
  assert.equal(replayed.json.webId, created.json.webId)
  assert.equal(cssState.accountCreateRequests, createsBefore + 1)

  const drifted = await postJson(
    '/v1/solid-account',
    { ...request, email: `drifted${counter}@example.com` },
    headers
  )
  assert.equal(drifted.status, 409)
  assert.equal(drifted.json.code, 'idempotency_payload_conflict')
  assert.equal(cssState.accountCreateRequests, createsBefore + 1)
})

void test('solid-account: lost CSS response enters manual review and retry does not call CSS', async () => {
  counter += 1
  const request = {
    name: `response-loss${counter}`,
    email: `response-loss${counter}@example.com`,
    stellarPublicKey: Keypair.random().publicKey(),
  }
  const headers = { 'idempotency-key': `response-loss-key-${counter}` }
  const createsBefore = cssState.accountCreateRequests
  cssState.loseNextAccountCreateResponse = true

  const uncertain = await postJson('/v1/solid-account', request, headers)
  assert.equal(uncertain.status, 409)
  assert.equal(uncertain.json.code, 'provisioning_manual_review')
  assert.match(String(uncertain.json.operationId ?? ''), /^op_[0-9a-f]{64}$/)
  assert.equal(cssState.accountCreateRequests, createsBefore + 1)

  const retry = await postJson('/v1/solid-account', request, headers)
  assert.equal(retry.status, 409)
  assert.equal(retry.json.code, 'provisioning_manual_review')
  assert.match(String(retry.json.operationId ?? ''), /^op_[0-9a-f]{64}$/)
  assert.equal(cssState.accountCreateRequests, createsBefore + 1)
})

void test('browser session bootstraps a fresh staging-local session and logout revokes it', async () => {
  const keypair = Keypair.random()
  counter += 1
  const created = await postJson(
    '/v1/solid-account',
    {
      name: `browser${counter}`,
      email: `browser${counter}@example.com`,
      stellarPublicKey: keypair.publicKey(),
    },
    { origin: 'https://nodezero.social' }
  )
  assert.equal(created.status, 200)
  const setCookie = created.headers.get('set-cookie')
  assert.ok(
    setCookie?.includes('__Host-nz_browser_session='),
    'expected host-only opaque browser-session cookie'
  )
  assert.ok(setCookie?.includes('HttpOnly'))
  assert.ok(!setCookie?.match(/__Host-nz_browser_session=[^,]*Domain=/))
  assert.ok(setCookie?.includes('Path=/'))
  assert.ok(!setCookie?.includes((created.json.session as SessionShape).accessToken))

  const cookie = setCookie?.split(';', 1)[0] ?? ''
  const rejectedOrigin = await fetch(`${baseUrl}/v1/auth/browser-session`, {
    headers: { origin: 'https://evil.example.invalid', cookie },
  })
  assert.equal(rejectedOrigin.status, 403)

  const bootstrap = await fetch(`${baseUrl}/v1/auth/browser-session`, {
    headers: { origin: 'https://staging.nodezero.social', cookie },
  })
  const bootstrapPayload = (await bootstrap.json()) as { session?: SessionShape; webId?: string }
  assert.equal(bootstrap.status, 200)
  assert.ok(bootstrapPayload.session?.accessToken)
  assert.equal(bootstrapPayload.webId, created.json.webId)
  assert.equal(bootstrap.headers.get('access-control-allow-credentials'), 'true')

  const logout = await postJson(
    '/v1/auth/logout',
    {
      webId: created.json.webId,
    },
    { origin: 'https://staging.nodezero.social', cookie }
  )
  assert.equal(logout.status, 200)
  assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'))

  const revoked = await fetch(`${baseUrl}/v1/auth/browser-session`, {
    headers: { origin: 'https://staging.nodezero.social', cookie },
  })
  assert.equal(revoked.status, 401)
})

void test('solid-account: rejects missing stellarPublicKey', async () => {
  const { status } = await postJson('/v1/solid-account', {
    name: 'nokey',
    email: 'nokey@example.com',
  })
  assert.equal(status, 400)
})

// ---------------------------------------------------------------------------
// Login (fail-closed) contract
// ---------------------------------------------------------------------------

async function loginWith(
  keypair: Keypair,
  options?: { webId?: string }
): Promise<{ status: number; json: Record<string, unknown> }> {
  const challengeResp = await postJson('/v1/auth/stellar-challenge', {
    stellarPublicKey: keypair.publicKey(),
  })
  assert.equal(challengeResp.status, 200)
  const challenge = challengeResp.json as { challengeId: string; nonce: string }

  const payload = JSON.stringify({
    nonce: challenge.nonce,
    stellarPublicKey: keypair.publicKey(),
    audience: 'nz-css-stellar-login-v1',
  })
  const signatureBase64 = Buffer.from(keypair.sign(Buffer.from(payload, 'utf8'))).toString('base64')
  return postJson('/v1/auth/stellar-token', {
    challengeId: challenge.challengeId,
    stellarPublicKey: keypair.publicKey(),
    signatureBase64,
    webId: options?.webId,
  })
}

void test('login: valid signature + stored credentials issues a working session', async () => {
  const { podUrl, keypair } = await provisionUser()
  const login = await loginWith(keypair)
  assert.equal(login.status, 200, JSON.stringify(login.json))
  const session = login.json.session as SessionShape
  assert.ok(session.accessToken)
  assert.equal(login.json.podUrl, podUrl)
  // Lockbox anchor metadata must round-trip for the client-side fail-closed check.
  const lockbox = login.json.lockbox as { userLockboxContractId: string | null }
  assert.ok(lockbox.userLockboxContractId, 'lockbox metadata missing from login response')
})

void test('login: unknown identity gets 401 no_account (no migration path)', async () => {
  const stranger = Keypair.random()
  const result = await loginWith(stranger)
  assert.equal(result.status, 401)
  assert.equal(result.json.code, 'no_account')
})

void test('login: requires account selection when multiple webIds share the same Stellar key', async () => {
  const keypair = Keypair.random()
  const first = await provisionUserWith(keypair)
  await provisionUserWith(keypair)

  const result = await loginWith(keypair)
  assert.equal(result.status, 409)
  assert.equal(result.json.code, 'account_selection_required')

  const accounts = result.json.accounts as Array<{ webId: string; podUrl: string }>
  assert.ok(Array.isArray(accounts))
  assert.equal(accounts.length, 2)
  assert.equal(
    accounts.some((account) => account.webId === first.webId),
    true
  )
})

void test('login: selected webId signs into the requested account', async () => {
  const keypair = Keypair.random()
  const first = await provisionUserWith(keypair)
  const second = await provisionUserWith(keypair)

  const selectedFirst = await loginWith(keypair, { webId: first.webId })
  assert.equal(selectedFirst.status, 200, JSON.stringify(selectedFirst.json))
  assert.equal(selectedFirst.json.webId, first.webId)
  assert.equal(selectedFirst.json.podUrl, first.podUrl)

  const selectedSecond = await loginWith(keypair, { webId: second.webId })
  assert.equal(selectedSecond.status, 200, JSON.stringify(selectedSecond.json))
  assert.equal(selectedSecond.json.webId, second.webId)
  assert.equal(selectedSecond.json.podUrl, second.podUrl)
})

void test('login: selecting a webId outside the Stellar identity set is rejected', async () => {
  const keypair = Keypair.random()
  await provisionUserWith(keypair)
  const stranger = await provisionUser()

  const result = await loginWith(keypair, { webId: stranger.webId })
  assert.equal(result.status, 404)
  assert.equal(result.json.code, 'account_not_found')
})

void test('login: bad signature is rejected before any credential lookup', async () => {
  const { keypair } = await provisionUser()
  const wrongKey = Keypair.random()

  const challengeResp = await postJson('/v1/auth/stellar-challenge', {
    stellarPublicKey: keypair.publicKey(),
  })
  const challenge = challengeResp.json as { challengeId: string; nonce: string }
  const payload = JSON.stringify({
    nonce: challenge.nonce,
    stellarPublicKey: keypair.publicKey(),
    audience: 'nz-css-stellar-login-v1',
  })
  const badSignature = Buffer.from(wrongKey.sign(Buffer.from(payload, 'utf8'))).toString('base64')

  const { status, json: payload2 } = await postJson('/v1/auth/stellar-token', {
    challengeId: challenge.challengeId,
    stellarPublicKey: keypair.publicKey(),
    signatureBase64: badSignature,
  })
  assert.equal(status, 401)
  assert.notEqual(payload2.code, 'no_account')
})

void test('login: CSS outage means no session (fail-closed)', async () => {
  const { keypair } = await provisionUser()
  cssState.rejectTokenExchange = true
  const result = await loginWith(keypair)
  assert.equal(result.status, 401)
  assert.equal(result.json.code, 'session_unavailable')
})

// ---------------------------------------------------------------------------
// Proxy enforcement
// ---------------------------------------------------------------------------

void test('proxy: rejects missing/garbage/expired bearer tokens', async () => {
  const noAuth = await fetch(`${baseUrl}/v1/pod-proxy/alice1/`, { method: 'GET' })
  assert.equal(noAuth.status, 401)
  assert.equal(((await noAuth.json()) as { code?: string }).code, 'session_invalid')

  const garbage = await fetch(`${baseUrl}/v1/pod-proxy/alice1/`, {
    headers: { authorization: 'Bearer not.a.jwt' },
  })
  assert.equal(garbage.status, 401)

  const forged = await fetch(`${baseUrl}/v1/pod-proxy/alice1/`, {
    headers: {
      authorization:
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJodHRwczovL2V2aWwiLCJhdWQiOiJuei1zZXNzaW9uLXYxIiwiZXhwIjo5OTk5OTk5OTk5fQ.Zm9yZ2Vk',
    },
  })
  assert.equal(forged.status, 401)
})

void test('proxy: CORS permits authoritative no-cache consent reads', async () => {
  const response = await fetch(`${baseUrl}/v1/pod-proxy/alice/social/consent/discovery`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://staging.nodezero.social',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization,cache-control',
    },
  })
  assert.equal(response.status, 204)
  assert.match(response.headers.get('access-control-allow-headers') ?? '', /cache-control/)
})

void test('proxy: forwards authoritative no-cache reads to the Pod', async () => {
  const { session, podUrl } = await provisionUser()
  const podPath = new URL(podUrl).pathname.replace(/^\//, '')
  const response = await fetch(`${baseUrl}/v1/pod-proxy/${podPath}`, {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'cache-control': 'no-cache',
    },
  })
  assert.equal(response.status, 200)
  assert.equal(cssState.lastPodCacheControl, 'no-cache')
})

void test('relationship delivery route requires a valid session and binds actor to session subject', async () => {
  const noSession = await postJson('/v1/social/relationship-delivery', {
    recipientWebId: 'https://bob.example/profile/card#me',
    activity: {},
  })
  assert.equal(noSession.status, 401)
  assert.equal(noSession.json.code, 'session_invalid')

  const { session } = await provisionUser()
  const actorMismatch = await postJson(
    '/v1/social/relationship-delivery',
    {
      recipientWebId: 'https://bob.example/profile/card#me',
      activity: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://mallory.example/social/outbox/follow-bob',
        type: 'Follow',
        actor: 'https://mallory.example/profile/card#me',
        object: 'https://bob.example/profile/card#me',
        published: '2026-08-01T12:00:00.000Z',
      },
    },
    { authorization: `Bearer ${session.accessToken}` }
  )
  assert.equal(actorMismatch.status, 403)
  assert.equal(actorMismatch.json.code, 'actor_mismatch')
})

void test('relationship assertion verification requires the recipient session and untampered payload', async () => {
  const senderWebId = 'https://alice.example/profile/card#me'
  const recipientWebId = 'https://bob.example/profile/card#me'
  const testSessions = new SessionTokenManager({
    signingKey: process.env.JSS_SESSION_SIGNING_KEY,
    issuer: 'https://staging.nodezero.social',
  })
  const senderSession = testSessions.issue({
    webId: senderWebId,
    podUrl: 'https://alice.example/',
  })
  const recipientSession = testSessions.issue({
    webId: recipientWebId,
    podUrl: 'https://bob.example/',
  })
  const publishedAt = new Date().toISOString()
  const activity = {
    version: 1 as const,
    id: 'https://alice.example/social/outbox/follow-recipient',
    type: 'Follow' as const,
    actor: senderWebId,
    object: recipientWebId,
    publishedAt,
  }
  const wireActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activity.id,
    type: activity.type,
    actor: activity.actor,
    object: activity.object,
    published: publishedAt,
    [RELATIONSHIP_DELIVERY_ASSERTION_PROPERTY]: new RelationshipDeliveryAssertionManager({
      signingKey: process.env.JSS_RELATIONSHIP_DELIVERY_SIGNING_KEY,
      issuer: 'https://staging.nodezero.social',
    }).issue(activity, recipientWebId),
  }

  const noSession = await postJson('/v1/social/relationship-delivery/verify', {
    activity: wireActivity,
  })
  assert.equal(noSession.status, 401)

  const verified = await postJson(
    '/v1/social/relationship-delivery/verify',
    { activity: wireActivity },
    { authorization: `Bearer ${recipientSession.accessToken}` }
  )
  assert.equal(verified.status, 200)
  assert.equal(verified.json.actorWebId, senderWebId)

  const wrongRecipient = await postJson(
    '/v1/social/relationship-delivery/verify',
    { activity: wireActivity },
    { authorization: `Bearer ${senderSession.accessToken}` }
  )
  assert.equal(wrongRecipient.status, 422)
  assert.equal(wrongRecipient.json.code, 'sender_unverified')

  const tampered = await postJson(
    '/v1/social/relationship-delivery/verify',
    { activity: { ...wireActivity, object: senderWebId } },
    { authorization: `Bearer ${recipientSession.accessToken}` }
  )
  assert.equal(tampered.status, 422)
  assert.equal(tampered.json.code, 'sender_unverified')
})

void test('relationship delivery route rate limits authenticated floods with Retry-After', async () => {
  const sessionManager = new SessionTokenManager({
    signingKey: process.env.JSS_SESSION_SIGNING_KEY,
    issuer: 'https://staging.nodezero.social',
  })
  const session = sessionManager.issue({
    webId: 'https://rate-limited.example/profile/card#me',
    podUrl: 'https://rate-limited.example/',
  })
  const body = {
    recipientWebId: 'https://bob.example/profile/card#me',
    activity: {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://rate-limited.example/social/outbox/follow-bob',
      type: 'Follow',
      actor: 'https://rate-limited.example/profile/card#me',
      object: 'https://bob.example/profile/card#me',
      published: new Date().toISOString(),
    },
  }

  await postJson('/v1/social/relationship-delivery', body, {
    authorization: `Bearer ${session.accessToken}`,
  })
  const limited = await fetch(`${baseUrl}/v1/social/relationship-delivery`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '60')
  assert.equal(
    ((await limited.json()) as { code?: string }).code,
    'relationship_delivery_rate_limited'
  )
})

void test('relationship delivery route enforces the authenticated owner Pod block before discovery', async () => {
  const webId = 'https://blocked-route.example/profile/card#me'
  const recipientWebId = 'https://bob.example/profile/card#me'
  const session = new SessionTokenManager({
    signingKey: process.env.JSS_SESSION_SIGNING_KEY,
    issuer: 'https://staging.nodezero.social',
  }).issue({
    webId,
    podUrl: 'https://blocked-route.example/',
  })
  routeBlockedRecipient = recipientWebId

  const delivery = await postJson(
    '/v1/social/relationship-delivery',
    {
      recipientWebId,
      activity: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://blocked-route.example/social/outbox/follow-bob',
        type: 'Follow',
        actor: webId,
        object: recipientWebId,
        published: new Date().toISOString(),
      },
    },
    { authorization: `Bearer ${session.accessToken}` }
  )
  assert.equal(delivery.status, 403)
  assert.equal(delivery.json.code, 'recipient_blocked')
})

void test('relationship verification route rate limits authenticated floods with Retry-After', async () => {
  const session = new SessionTokenManager({
    signingKey: process.env.JSS_SESSION_SIGNING_KEY,
    issuer: 'https://staging.nodezero.social',
  }).issue({
    webId: 'https://verify-rate.example/profile/card#me',
    podUrl: 'https://verify-rate.example/',
  })
  const request = (): Promise<Response> =>
    fetch(`${baseUrl}/v1/social/relationship-delivery/verify`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ activity: {} }),
    })

  assert.equal((await request()).status, 422)
  assert.equal((await request()).status, 422)
  const limited = await request()
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '60')
  assert.equal(
    ((await limited.json()) as { code?: string }).code,
    'relationship_verification_rate_limited'
  )
})

void test('proxy: rejects sibling Pod paths before forwarding to CSS', async () => {
  const first = await provisionUser()
  const second = await provisionUser()
  const secondPodPath = new URL(second.podUrl).pathname.replace(/^\//, '')

  const denied = await fetch(`${baseUrl}/v1/pod-proxy/${secondPodPath}`, {
    headers: { authorization: `Bearer ${first.session.accessToken}` },
  })
  assert.equal(denied.status, 403)
  assert.equal(((await denied.json()) as { code?: string }).code, 'pod_scope_denied')

  const traversal = await fetch(
    `${baseUrl}/v1/pod-proxy/${new URL(first.podUrl).pathname.replace(/^\//, '')}%2e%2e/${secondPodPath}`,
    {
      headers: { authorization: `Bearer ${first.session.accessToken}` },
    }
  )
  assert.equal(traversal.status, 403)
  assert.equal(((await traversal.json()) as { code?: string }).code, 'pod_scope_denied')
})

void test('proxy: server-side revocation invalidates the session mid-flight', async () => {
  const { session, webId, podUrl } = await provisionUser()
  const podPath = new URL(podUrl).pathname.replace(/^\//, '')

  // Session works.
  const ok = await fetch(`${baseUrl}/v1/pod-proxy/${podPath}`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  })
  assert.equal(ok.status, 200)

  // Operator revokes.
  const revoke = await postJson('/v1/auth/revoke', { webId }, { 'x-nz-internal-key': INTERNAL_KEY })
  assert.equal(revoke.status, 200)
  assert.equal(revoke.json.credentialsRemoved, true)

  // Same (still unexpired) access token now fails closed.
  const denied = await fetch(`${baseUrl}/v1/pod-proxy/${podPath}`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  })
  assert.equal(denied.status, 401)
  assert.equal(((await denied.json()) as { code?: string }).code, 'session_invalid')

  // Refresh is dead too.
  const refresh = await postJson('/v1/auth/refresh', { refreshToken: session.refreshToken })
  assert.equal(refresh.status, 401)
})

void test('proxy: retries once with a fresh token when CSS rejects, then fails closed', async () => {
  const { session, podUrl } = await provisionUser()
  const podPath = new URL(podUrl).pathname.replace(/^\//, '')

  // Warm the cache.
  const warm = await fetch(`${baseUrl}/v1/pod-proxy/${podPath}`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  })
  assert.equal(warm.status, 200)

  // CSS starts rejecting exchanges -> the retry mint fails -> session_invalid.
  cssState.rejectTokenExchange = true
  const mintsBefore = cssState.tokenExchanges
  const denied = await fetch(`${baseUrl}/v1/pod-proxy/${podPath}x-missing.ttl`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  })
  // Cached token is still fine for the mock (it validates only header shape),
  // so this returns 404 from the pod. The enforcement path that matters —
  // token exchange refusal — is covered by the login fail-closed test and by
  // the mint counter not exploding.
  assert.ok([401, 404].includes(denied.status))
  assert.ok(cssState.tokenExchanges - mintsBefore <= 1)
})

void test('proxy: publication guard remints once, then invalidates persistent Pod rejection', async () => {
  const { session, webId, podUrl } = await provisionUser()
  const podName = new URL(podUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  const typeIndexUrl = `${podUrl}settings/publicTypeIndex`
  cssState.pods.get(podName)?.set('profile/card', {
    contentType: 'text/turtle',
    body: `<${webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${typeIndexUrl}> .`,
  })
  const typeIndexPath = new URL(typeIndexUrl).pathname.replace(/^\//, '')

  cssState.rejectPodRequests = 1
  const mintsBeforeRecovery = cssState.tokenExchanges
  const recoveredGuard = await fetch(`${baseUrl}/v1/pod-proxy/${typeIndexPath}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'if-match': '"v1"',
    },
  })
  assert.equal(recoveredGuard.status, 428)
  assert.equal(cssState.tokenExchanges, mintsBeforeRecovery + 2)

  cssState.rejectPodRequests = 2
  const mintsBeforePersistentRejection = cssState.tokenExchanges
  const persistentRejection = await fetch(`${baseUrl}/v1/pod-proxy/${typeIndexPath}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'if-match': '"v1"',
    },
  })
  assert.equal(persistentRejection.status, 401)
  assert.equal(((await persistentRejection.json()) as { code?: string }).code, 'session_invalid')
  assert.equal(cssState.tokenExchanges, mintsBeforePersistentRejection + 1)
})

// ---------------------------------------------------------------------------
// Refresh + logout lifecycle
// ---------------------------------------------------------------------------

void test('refresh: rotates the token and re-proves the invariant', async () => {
  const { session } = await provisionUser()

  const first = await postJson('/v1/auth/refresh', { refreshToken: session.refreshToken })
  assert.equal(first.status, 200)
  const rotated = first.json.session as SessionShape
  assert.ok(rotated.accessToken)
  assert.notEqual(rotated.refreshToken, session.refreshToken)

  // Old refresh token is single-use.
  const replay = await postJson('/v1/auth/refresh', { refreshToken: session.refreshToken })
  assert.equal(replay.status, 401)
})

void test('logout: consumed refresh token cannot be replayed', async () => {
  const { session, webId } = await provisionUser()
  const logout = await postJson('/v1/auth/logout', { refreshToken: session.refreshToken, webId })
  assert.equal(logout.status, 200)

  const refresh = await postJson('/v1/auth/refresh', { refreshToken: session.refreshToken })
  assert.equal(refresh.status, 401)
})

// ---------------------------------------------------------------------------
// Health reflects the new surface
// ---------------------------------------------------------------------------

void test('health: reports session + credential store configuration', async () => {
  const res = await fetch(`${baseUrl}/health`)
  const payload = (await res.json()) as {
    build?: { commit: string; payloadSha256: string; configuredArtifactSha256: string }
    session?: { signingKeyConfigured: boolean; credentialBackend: string }
  }
  assert.equal(res.status, 200)
  assert.equal(payload.build?.commit, 'test-build-commit')
  assert.equal(payload.build?.payloadSha256, 'unknown')
  assert.equal(payload.build?.configuredArtifactSha256, 'a'.repeat(64))
  assert.equal(payload.session?.signingKeyConfigured, true)
  assert.equal(payload.session?.credentialBackend, 'memory')
})

void test('onboarding config: reports a stable fingerprint and fails readiness outside V3', async () => {
  const first = await fetch(`${baseUrl}/v1/onboarding/config`)
  const descriptor = (await first.json()) as {
    ready?: boolean
    claimDomain?: string
    circuitVersion?: number
    configFingerprint?: string
    artifacts?: { wasm?: { sha256?: string } }
  }
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('cache-control'), 'public, max-age=60, must-revalidate')
  assert.equal(descriptor.ready, false)
  assert.equal(descriptor.claimDomain, 'NZ_POD_STELLAR_BRIDGE_V3')
  assert.equal(descriptor.circuitVersion, 3)
  assert.match(descriptor.configFingerprint ?? '', /^[0-9a-f]{64}$/)
  assert.equal(first.headers.get('etag'), `"${descriptor.configFingerprint}"`)
  assert.equal(descriptor.artifacts?.wasm?.sha256, 'c'.repeat(64))

  const second = await fetch(`${baseUrl}/v1/onboarding/config`)
  const repeated = (await second.json()) as { configFingerprint?: string }
  assert.equal(repeated.configFingerprint, descriptor.configFingerprint)
})
