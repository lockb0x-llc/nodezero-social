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
import type { CredentialStore } from './credentialStore.js'
import type { SessionTokenManager, SessionClaims } from './sessionTokens.js'
import { mintPodAccessToken, type PodAccessToken } from './solidAccount.js'

export const POD_PROXY_PREFIX = '/v1/pod-proxy/'

/** Access tokens are re-minted this many ms before their reported expiry. */
const TOKEN_EXPIRY_SLACK_MS = 30_000

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
