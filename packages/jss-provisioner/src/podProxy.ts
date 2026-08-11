/**
 * @module podProxy
 *
 * Pod Access Proxy — the single runtime path between clients and CSS.
 *
 * `ALL /v1/pod-proxy/{path}` validates the NodeZero session (Bearer JWT),
 * resolves the user's stored client credentials, exchanges them for a cached
 * DPoP-bound access token, and forwards the LDP request to the internal CSS
 * base URL. The browser never talks to CSS and never holds Solid tokens.
 *
 * Fail-closed enforcement of the session invariant:
 *  - invalid/expired session JWT            -> 401 `session_invalid`
 *  - no stored credentials (revoked)        -> 401 `session_invalid`
 *  - CSS rejects the token (after one fresh  re-mint retry)
 *                                           -> 401 `session_invalid`
 *
 * A `401 session_invalid` instructs the client to destroy its session and
 * return to the sign-in page.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { Quad } from '@rdfjs/types'
import { PublicTypeIndexManager } from '@nodezero/solid-pod-sync'
import { DiscoveryManifestManager } from '@nodezero/solid-pod-sync'
import { Parser as SparqlParser } from 'sparqljs'
import { rdfParser } from 'rdf-parse'
import type { CredentialStore } from './credentialStore.js'
import type { SessionTokenManager, SessionClaims } from './sessionTokens.js'
import { mintPodAccessToken, type PodAccessToken } from './solidAccount.js'

export const POD_PROXY_PREFIX = '/v1/pod-proxy/'

/** Access tokens are re-minted this many ms before their reported expiry. */
const TOKEN_EXPIRY_SLACK_MS = 30_000
const SOLID_PUBLIC_TYPE_INDEX = 'http://www.w3.org/ns/solid/terms#publicTypeIndex'

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'PUT', 'POST', 'PATCH', 'DELETE'])

/** Request headers forwarded verbatim to CSS. */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'x-nodezero-publication-revision',
  'slug',
  'link',
  'depth',
  'range',
]

/** Response headers surfaced back to the client. */
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'etag',
  'last-modified',
  'location',
  'link',
  'accept-patch',
  'accept-put',
  'accept-post',
  'allow',
  'wac-allow',
  'ms-author-via',
  'updates-via',
  'vary',
]

export interface PodProxyDeps {
  cssBaseUrl: string
  credentialStore: CredentialStore
  sessions: SessionTokenManager
  corsHeaders: (req: IncomingMessage) => Record<string, string>
  /** Injectable for tests. */
  mintToken?: typeof mintPodAccessToken
  auditLog?: (event: string, detail: Record<string, unknown>) => void
}

interface CachedToken {
  token: PodAccessToken
  webId: string
}

class PublicationGuardAuthenticationError extends Error {}

const tokenCache = new Map<string, CachedToken>()

/** Test hook: clears the process-wide token cache. */
export function clearPodTokenCache(): void {
  tokenCache.clear()
}

/** Evicts the cached Solid token for one WebID (revocation path). */
export function evictPodTokenCache(webId: string): void {
  tokenCache.delete(webId.trim())
}

export function podProxyAuditDigest(
  kind: 'identity' | 'resource' | 'error',
  value: string
): string {
  return createHash('sha256').update(`NZ_POD_PROXY_AUDIT_V1|${kind}|${value}`, 'utf8').digest('hex')
}

export class PodProxyTargetError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'PodProxyTargetError'
  }
}

export function buildPodProxyTarget(
  cssBaseUrl: string,
  sessionPodUrl: string,
  rawRest: string
): string {
  let cssBase: URL
  let sessionPod: URL
  try {
    cssBase = new URL(cssBaseUrl.endsWith('/') ? cssBaseUrl : `${cssBaseUrl}/`)
    sessionPod = new URL(sessionPodUrl.endsWith('/') ? sessionPodUrl : `${sessionPodUrl}/`)
  } catch {
    throw new PodProxyTargetError(
      'Pod proxy target configuration is invalid.',
      'pod_target_invalid'
    )
  }

  if (cssBase.origin !== sessionPod.origin) {
    throw new PodProxyTargetError(
      'Session Pod origin does not match the configured Pod server.',
      'pod_origin_mismatch'
    )
  }

  const rawPath = rawRest.split('?', 1)[0] ?? ''
  if (
    rawPath.startsWith('/') ||
    rawPath.includes('\\') ||
    /(?:^|\/)\.\.?($|\/)/.test(rawPath) ||
    /%(?:2f|5c|2e)/i.test(rawPath)
  ) {
    throw new PodProxyTargetError('Pod proxy path is not allowed.', 'pod_path_invalid')
  }

  let target: URL
  try {
    decodeURIComponent(rawPath)
    target = new URL(rawRest, cssBase)
  } catch {
    throw new PodProxyTargetError('Pod proxy path is malformed.', 'pod_path_invalid')
  }

  const podPath = sessionPod.pathname.endsWith('/')
    ? sessionPod.pathname
    : `${sessionPod.pathname}/`
  const targetPath = target.pathname
  if (targetPath !== podPath.slice(0, -1) && !targetPath.startsWith(podPath)) {
    throw new PodProxyTargetError(
      'The requested resource is outside the authenticated Pod namespace.',
      'pod_scope_denied'
    )
  }

  return target.toString()
}

function sendProxyJson(
  req: IncomingMessage,
  res: ServerResponse,
  cors: (req: IncomingMessage) => Record<string, string>,
  statusCode: number,
  payload: unknown
): void {
  res.writeHead(statusCode, {
    ...cors(req),
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(payload))
}

function readBearerToken(req: IncomingMessage): string | null {
  const value = req.headers.authorization ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match ? match[1].trim() : null
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function resolveAccessToken(
  deps: PodProxyDeps,
  claims: SessionClaims,
  forceFresh: boolean
): Promise<PodAccessToken | null> {
  const cacheKey = claims.sub
  if (!forceFresh) {
    const cached = tokenCache.get(cacheKey)
    if (cached && cached.token.expiresAtMs - TOKEN_EXPIRY_SLACK_MS > Date.now()) {
      return cached.token
    }
  }

  const credentials = await deps.credentialStore.findByWebId(claims.sub)
  if (!credentials) {
    tokenCache.delete(cacheKey)
    return null
  }

  const mint = deps.mintToken ?? mintPodAccessToken
  const token = await mint(deps.cssBaseUrl, {
    id: credentials.clientCredentialsId,
    secret: credentials.clientCredentialsSecret,
  })
  tokenCache.set(cacheKey, { token, webId: claims.sub })
  deps.auditLog?.('pod-token.minted', {
    identityDigest: podProxyAuditDigest('identity', claims.sub),
    expiresAtMs: token.expiresAtMs,
  })
  return token
}

/**
 * Handles a request under `/v1/pod-proxy/`. Returns `true` when the request
 * was handled (so the main router can fall through otherwise).
 */
export async function handlePodProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PodProxyDeps
): Promise<boolean> {
  const rawUrl = req.url ?? '/'
  if (!rawUrl.startsWith(POD_PROXY_PREFIX)) return false

  const method = (req.method ?? 'GET').toUpperCase()
  if (!ALLOWED_METHODS.has(method)) {
    sendProxyJson(req, res, deps.corsHeaders, 405, {
      error: 'Method not allowed.',
      code: 'method_not_allowed',
    })
    return true
  }

  if (!deps.cssBaseUrl) {
    sendProxyJson(req, res, deps.corsHeaders, 503, {
      error: 'Pod proxy is not configured (JSS_SOLID_CSS_BASE_URL).',
      code: 'not_configured',
    })
    return true
  }

  const bearer = readBearerToken(req)
  const claims = bearer ? deps.sessions.verify(bearer) : null
  if (!claims) {
    sendProxyJson(req, res, deps.corsHeaders, 401, {
      error: 'A valid NodeZero session is required.',
      code: 'session_invalid',
    })
    return true
  }

  // Preserve raw (still-encoded) path + query when building the CSS target.
  const rest = rawUrl.slice(POD_PROXY_PREFIX.length)
  let targetUrl: string
  try {
    targetUrl = buildPodProxyTarget(deps.cssBaseUrl, claims.pod, rest)
  } catch (error) {
    const code = error instanceof PodProxyTargetError ? error.code : 'pod_target_invalid'
    sendProxyJson(req, res, deps.corsHeaders, 403, {
      error: 'The requested resource is outside this session Pod.',
      code,
    })
    return true
  }

  const body = method === 'GET' || method === 'HEAD' ? null : await readRawBody(req)

  let attemptedFresh = false
  for (;;) {
    let token: PodAccessToken | null
    try {
      token = await resolveAccessToken(deps, claims, attemptedFresh)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Solid token mint failed.'
      deps.auditLog?.('pod-token.mint-failed', {
        identityDigest: podProxyAuditDigest('identity', claims.sub),
        errorDigest: podProxyAuditDigest('error', message),
      })
      sendProxyJson(req, res, deps.corsHeaders, 401, {
        error: 'Solid access could not be established for this session.',
        code: 'session_invalid',
      })
      return true
    }
    if (!token) {
      sendProxyJson(req, res, deps.corsHeaders, 401, {
        error: 'This session has been revoked.',
        code: 'session_invalid',
      })
      return true
    }

    let protectedPublicationMutation: boolean
    try {
      protectedPublicationMutation = await isProtectedPublicationMutation(
        targetUrl,
        method,
        body,
        typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : '',
        claims,
        token
      )
    } catch (error) {
      if (error instanceof PublicationGuardAuthenticationError && !attemptedFresh) {
        attemptedFresh = true
        tokenCache.delete(claims.sub)
        continue
      }
      if (error instanceof PublicationGuardAuthenticationError) {
        tokenCache.delete(claims.sub)
        sendProxyJson(req, res, deps.corsHeaders, 401, {
          error: 'Solid access was rejected for this session.',
          code: 'session_invalid',
        })
        return true
      }
      const message = error instanceof Error ? error.message : 'Publication guard failed.'
      deps.auditLog?.('pod-proxy.publication-guard-failed', {
        identityDigest: podProxyAuditDigest('identity', claims.sub),
        resourceDigest: podProxyAuditDigest('resource', targetUrl),
        errorDigest: podProxyAuditDigest('error', message),
      })
      sendProxyJson(req, res, deps.corsHeaders, 503, {
        error: 'Publication mutation safety could not be established.',
        code: 'publication_guard_unavailable',
      })
      return true
    }
    if (protectedPublicationMutation) {
      const publicationRevision = req.headers['x-nodezero-publication-revision']
      const hasRevision =
        typeof publicationRevision === 'string' && /^\d+$/.test(publicationRevision)
      const hasWritePrecondition =
        isValidIfMatch(req.headers['if-match']) || req.headers['if-none-match'] === '*'
      if (!hasRevision || !hasWritePrecondition) {
        sendProxyJson(req, res, deps.corsHeaders, 428, {
          error: 'Publication mutations require a generation and HTTP precondition.',
          code: 'publication_precondition_required',
        })
        return true
      }
    }

    const headers: Record<string, string> = {
      authorization: `DPoP ${token.accessToken}`,
      dpop: token.proof(targetUrl, method),
    }
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.headers[name]
      if (typeof value === 'string' && value) headers[name] = value
      else if (Array.isArray(value) && value.length) headers[name] = value.join(', ')
    }

    let upstream: Response
    try {
      upstream = await fetch(targetUrl, {
        method,
        headers,
        body: body && body.length ? new Uint8Array(body) : null,
        redirect: 'manual',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CSS request failed.'
      sendProxyJson(req, res, deps.corsHeaders, 502, {
        error: message,
        code: 'upstream_unreachable',
      })
      return true
    }

    if (upstream.status === 401 && !attemptedFresh) {
      // The cached token may have been revoked upstream — retry exactly once
      // with a freshly minted token before declaring the session invalid.
      attemptedFresh = true
      tokenCache.delete(claims.sub)
      continue
    }

    if (upstream.status === 401) {
      deps.auditLog?.('pod-proxy.session-invalid', {
        identityDigest: podProxyAuditDigest('identity', claims.sub),
        resourceDigest: podProxyAuditDigest('resource', targetUrl),
      })
      sendProxyJson(req, res, deps.corsHeaders, 401, {
        error: 'Solid access was rejected for this session.',
        code: 'session_invalid',
      })
      return true
    }

    const responseHeaders: Record<string, string> = { ...deps.corsHeaders(req) }
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name)
      if (value !== null) responseHeaders[name] = value
    }
    // The proxy re-frames the body; drop any upstream content-length mismatch.
    delete responseHeaders['content-length']

    const payload = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(upstream.status, responseHeaders)
    res.end(payload)
    return true
  }
}

function isValidIfMatch(value: string | undefined): boolean {
  if (!value) return false
  return /^"[\x21\x23-\x7e\x80-\xff]*"(?:\s*,\s*"[\x21\x23-\x7e\x80-\xff]*")*$/.test(
    value.trim()
  )
}

async function isProtectedPublicationMutation(
  targetUrl: string,
  method: string,
  body: Buffer | null,
  contentType: string,
  claims: SessionClaims,
  token: PodAccessToken
): Promise<boolean> {
  if (!['PUT', 'PATCH', 'DELETE'].includes(method)) return false
  const target = new URL(targetUrl)
  const pathname = target.pathname
  const profileUrl = claims.sub.split('#')[0] ?? ''
  const targetsProfile = sameResourcePath(target, new URL(profileUrl))
  if (
    pathname.endsWith('/social/consent/discovery') ||
    pathname.endsWith('/public/discovery/manifest')
  ) {
    return true
  }
  const text = body?.toString('utf8') ?? ''
  if (
    isRdfMutationContentType(contentType) &&
    (text.includes('nodezero-discovery-manifest') ||
      text.includes('https://nodezero.social/ns#DiscoveryManifest'))
  ) {
    return true
  }
  if (method !== 'DELETE' && !isRdfMutationContentType(contentType) && !targetsProfile) {
    return false
  }
  const ownerFetch: typeof globalThis.fetch = (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const requestMethod = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    headers.set('authorization', `DPoP ${token.accessToken}`)
    headers.set('dpop', token.proof(url, requestMethod))
    return fetch(url, { ...init, method: requestMethod, headers }).then((response) => {
      if (response.status === 401) throw new PublicationGuardAuthenticationError()
      return response
    })
  }
  const typeIndexManager = new PublicTypeIndexManager({ fetch: ownerFetch })
  const publicTypeIndexUrl = await typeIndexManager.discoverPublicTypeIndex(claims.sub)
  if (targetsProfile) {
    if (method === 'DELETE') return publicTypeIndexUrl !== null
    if (method === 'PATCH') {
      return sparqlUpdateTouchesOrMayRemovePredicate(text, SOLID_PUBLIC_TYPE_INDEX)
    }
    if (method === 'PUT') {
      if (!isRdfRepresentationContentType(contentType)) {
        return publicTypeIndexUrl !== null
      }
      const replacementTypeIndexUrls = await parseRdfPredicateObjects(
        body ?? Buffer.alloc(0),
        contentType,
        claims.sub,
        SOLID_PUBLIC_TYPE_INDEX,
        target.toString()
      )
      return publicTypeIndexUrl === null
        ? replacementTypeIndexUrls.length > 0
        : replacementTypeIndexUrls.length !== 1 ||
            replacementTypeIndexUrls[0] !== publicTypeIndexUrl
    }
  }
  if (publicTypeIndexUrl !== null && sameResourcePath(target, new URL(publicTypeIndexUrl))) {
    return true
  }
  const podRoot = claims.pod.endsWith('/') ? claims.pod : `${claims.pod}/`
  const manifest = await new DiscoveryManifestManager({ fetch: ownerFetch }).readManifest(podRoot)
  if (
    manifest?.publicTypeIndexUrl &&
    sameResourcePath(target, new URL(manifest.publicTypeIndexUrl))
  ) {
    return true
  }
  return false
}

function sameResourcePath(left: URL, right: URL): boolean {
  return left.origin === right.origin && left.pathname === right.pathname
}

function isRdfMutationContentType(contentType: string): boolean {
  return /(?:text\/turtle|application\/(?:sparql-update|ld\+json|rdf\+xml|n-triples))/i.test(
    contentType
  )
}

function isRdfRepresentationContentType(contentType: string): boolean {
  return /(?:text\/turtle|application\/(?:ld\+json|rdf\+xml|n-triples))/i.test(contentType)
}

function sparqlUpdateTouchesOrMayRemovePredicate(
  updateText: string,
  predicate: string
): boolean {
  const parsed = new SparqlParser().parse(updateText)
  if (parsed.type !== 'update') throw new Error('Profile PATCH must be a SPARQL update.')
  if (containsNamedNode(parsed, predicate)) return true
  return parsed.updates.some((operation) => {
    if ('type' in operation) return true
    return containsNonConcretePredicate(operation)
  })
}

async function parseRdfPredicateObjects(
  body: Buffer,
  contentType: string,
  subject: string,
  predicate: string,
  baseIRI: string
): Promise<string[]> {
  if (/application\/ld\+json/i.test(contentType)) {
    assertNoRemoteJsonLdContexts(JSON.parse(body.toString('utf8')))
  }
  const objects: string[] = []
  const stream = rdfParser.parse(Readable.from([body]), {
    contentType: contentType.split(';', 1)[0]?.trim() ?? contentType,
    baseIRI,
  }) as AsyncIterable<Quad>
  for await (const quad of stream) {
    if (
      quad.subject.termType === 'NamedNode' &&
      quad.subject.value === subject &&
      quad.predicate.termType === 'NamedNode' &&
      quad.predicate.value === predicate &&
      quad.object.termType === 'NamedNode'
    ) {
      objects.push(quad.object.value)
    }
  }
  return objects
}

function assertNoRemoteJsonLdContexts(value: unknown): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) assertNoRemoteJsonLdContexts(item)
    return
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === '@import') {
      throw new Error('JSON-LD context imports are not allowed for Pod proxy mutations.')
    }
    if (key === '@context') {
      const contexts = Array.isArray(item) ? item : [item]
      if (contexts.some((context) => typeof context === 'string')) {
        throw new Error('Remote JSON-LD contexts are not allowed for Pod proxy mutations.')
      }
    }
    assertNoRemoteJsonLdContexts(item)
  }
}

function containsNamedNode(value: unknown, iri: string): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.termType === 'NamedNode' && record.value === iri) return true
  return Object.values(record).some((candidate) =>
    Array.isArray(candidate)
      ? candidate.some((item) => containsNamedNode(item, iri))
      : containsNamedNode(candidate, iri)
  )
}

function containsNonConcretePredicate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const predicate = record.predicate as Record<string, unknown> | undefined
  if (predicate && predicate.termType !== 'NamedNode') return true
  return Object.values(record).some((candidate) =>
    Array.isArray(candidate)
      ? candidate.some(containsNonConcretePredicate)
      : containsNonConcretePredicate(candidate)
  )
}
