import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ProvisionStore } from './store.js'
import { verifyAttestation } from './attestation.js'
import { createSolidAccount, patchPodProfileAnchor, writePodAccountDocument } from './solidAccount.js'
import { treasuryCreateAccount } from './treasuryCreateAccount.js'
import { anchorAttestation } from './attestationAnchor.js'
import {
  createNotificationEventPublisherFromEnv,
  publishProvisioningEvent,
} from './notificationEvents.js'
import { CommunityDirectoryStore } from './communityDirectory.js'
import type {
  BootstrapChallengeRequest,
  ProvisionRequest,
  ProvisionResult,
} from './types.js'

const PORT = Number(process.env.PORT ?? process.env.JSS_PROVISIONER_PORT ?? 8181)
const ISSUER = process.env.JSS_ISSUER_URL ?? 'https://staging.nodezero.social'
const PUBLIC_PROVISIONER_BASE_URL =
  (process.env.JSS_PUBLIC_PROVISIONER_BASE_URL ?? ISSUER).trim().replace(/\/+$/, '')
const SOLID_CSS_BASE_URL = (process.env.JSS_SOLID_CSS_BASE_URL ?? '').trim().replace(/\/+$/, '')
const LOCKBOX_FACTORY_CONTRACT_ID =
  process.env.JSS_LOCKBOX_FACTORY_CONTRACT_ID ?? process.env.NZ_LOCKBOX_FACTORY_CONTRACT_ID ?? ''
const LOCKBOX_FACTORY_MODE = (process.env.JSS_LOCKBOX_FACTORY_MODE ?? 'mock').toLowerCase()
// P3: Treasury-sponsored member account creation is a privileged, funds-moving
// operation. It is disabled unless an internal API key is configured, and every
// request must present it (fail-closed). This prevents an open endpoint from
// draining the Treasury by creating accounts for arbitrary fresh keys.
const INTERNAL_API_KEY = (process.env.JSS_INTERNAL_API_KEY ?? '').trim()
// P3: when enabled, the provisioner funds each member's Stellar account from the
// Treasury during onboarding (replacing testnet Friendbot on MainNet, where no
// faucet exists). Off by default to preserve the testnet Friendbot self-funding
// path; enable via JSS_TREASURY_FUND_MEMBERS=1 for MainNet readiness.
const TREASURY_FUND_MEMBERS = /^(1|true|yes)$/i.test((process.env.JSS_TREASURY_FUND_MEMBERS ?? '').trim())
const ALLOWED_ORIGINS = (process.env.JSS_ALLOWED_ORIGINS ?? 'https://staging.nodezero.social,https://nodezero.social,https://www.nodezero.social,https://solid.nodezero.social,http://localhost:19006,http://localhost:8081')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)
const store = new ProvisionStore()
const communityDirectory = new CommunityDirectoryStore()
const knownSolidAccountEmails = new Set<string>()
const notificationPublisher = createNotificationEventPublisherFromEnv()
const DOCUSTREAM_RSS_FETCH_TIMEOUT_MS = Number(process.env.JSS_DOCUSTREAM_RSS_FETCH_TIMEOUT_MS ?? 12000)
const DOCUSTREAM_RSS_MAX_BYTES = Number(process.env.JSS_DOCUSTREAM_RSS_MAX_BYTES ?? 1_000_000)
const DOCUSTREAM_RSS_MAX_REDIRECTS = Number(process.env.JSS_DOCUSTREAM_RSS_MAX_REDIRECTS ?? 3)
const DOCUSTREAM_ALLOWED_CONTENT_TYPES = [
  'application/rss+xml',
  'application/xml',
  'text/xml',
  'application/atom+xml',
]
const OIDC_BRIDGE_AUDIENCE = 'nz-solid-css-login-v1'

class DocustreamRssFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly errorCode: string,
  ) {
    super(message)
  }
}

function emitLifecycleEvent(
  eventType: string,
  payload: {
    webId?: string
    podUrl?: string
    stellarPublicKey?: string
    lockboxContractId?: string
    metadata?: Record<string, unknown>
  }
): void {
  void publishProvisioningEvent(notificationPublisher, eventType, {
    envProfile: process.env.NZ_ENV_PROFILE ?? 'local',
    issuer: ISSUER,
    ...payload,
  }).catch((error) => {
    console.warn('[jss-provisioner:event] publish failed:', error)
  })
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
}

function isValidProvisioningPassword(password: string): boolean {
  return password.trim().length >= 12
}

function rememberKnownSolidEmail(email: string): void {
  const normalized = normalizeEmail(email)
  if (isValidEmail(normalized)) {
    knownSolidAccountEmails.add(normalized)
  }
}

function isDuplicateEmailProvisioningMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('already is a login for this e-mail address') ||
    lower.includes('already is a login for this email address')
  )
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? '*'

  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-nz-internal-key',
    vary: 'origin',
  }
}

function sendJson(req: IncomingMessage, res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    ...corsHeaders(req),
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(payload))
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) {
    throw new Error('Request body is required.')
  }
  return JSON.parse(raw) as T
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function toOrigin(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin
  } catch {
    return null
  }
}

function isLoopbackOrPrivateAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    if (address.startsWith('10.')) return true
    if (address.startsWith('127.')) return true
    if (address.startsWith('169.254.')) return true
    if (address.startsWith('192.168.')) return true
    const octets = address.split('.').map((part) => Number(part))
    if (octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
    return false
  }

  if (version === 6) {
    const normalized = address.toLowerCase()
    if (normalized === '::1') return true
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
    if (normalized.startsWith('fe80')) return true
    return false
  }

  return false
}

async function validateDocustreamRssUrl(rawUrl: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new DocustreamRssFetchError('Feed URL is invalid.', 400, 'invalid_url')
  }

  if (parsed.protocol !== 'https:') {
    throw new DocustreamRssFetchError('Feed URL must use https.', 400, 'invalid_protocol')
  }

  if (parsed.username || parsed.password) {
    throw new DocustreamRssFetchError('Feed URL credentials are not allowed.', 400, 'invalid_credentials')
  }

  const host = parsed.hostname.trim().toLowerCase()
  if (!host || host === 'localhost') {
    throw new DocustreamRssFetchError('Feed host is not allowed.', 400, 'blocked_host')
  }

  if (isLoopbackOrPrivateAddress(host)) {
    throw new DocustreamRssFetchError('Feed host is not allowed.', 400, 'blocked_host')
  }

  const resolved = await lookup(host, { all: true, verbatim: true }).catch(() => [])
  if (!resolved.length) {
    throw new DocustreamRssFetchError('Feed host could not be resolved.', 400, 'unresolvable_host')
  }

  if (resolved.some((entry) => isLoopbackOrPrivateAddress(entry.address))) {
    throw new DocustreamRssFetchError('Feed host resolves to a blocked address.', 400, 'blocked_host')
  }

  return parsed
}

function ensureAllowedContentType(contentTypeHeader: string | null): void {
  const normalized = (contentTypeHeader ?? '').toLowerCase().split(';')[0].trim()
  if (!normalized || !DOCUSTREAM_ALLOWED_CONTENT_TYPES.includes(normalized)) {
    throw new DocustreamRssFetchError('Feed content type is not supported.', 415, 'unsupported_content_type')
  }
}

async function fetchDocustreamRssXml(feedUrl: URL): Promise<string> {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), DOCUSTREAM_RSS_FETCH_TIMEOUT_MS)

  try {
    let currentUrl = feedUrl
    for (let redirect = 0; redirect <= DOCUSTREAM_RSS_MAX_REDIRECTS; redirect += 1) {
      const response = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
        },
        redirect: 'manual',
        signal: controller.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          throw new DocustreamRssFetchError('Feed redirect location is missing.', 502, 'redirect_missing_location')
        }
        if (redirect === DOCUSTREAM_RSS_MAX_REDIRECTS) {
          throw new DocustreamRssFetchError('Feed has too many redirects.', 502, 'too_many_redirects')
        }
        currentUrl = await validateDocustreamRssUrl(new URL(location, currentUrl).toString())
        continue
      }

      if (!response.ok) {
        throw new DocustreamRssFetchError(`Feed responded with HTTP ${response.status}.`, 502, 'upstream_http_error')
      }

      ensureAllowedContentType(response.headers.get('content-type'))

      const declaredLength = Number(response.headers.get('content-length') ?? '0')
      if (declaredLength > DOCUSTREAM_RSS_MAX_BYTES) {
        throw new DocustreamRssFetchError('Feed payload exceeds maximum size.', 413, 'payload_too_large')
      }

      const xml = await response.text()
      const xmlBytes = Buffer.byteLength(xml, 'utf8')
      if (xmlBytes > DOCUSTREAM_RSS_MAX_BYTES) {
        throw new DocustreamRssFetchError('Feed payload exceeds maximum size.', 413, 'payload_too_large')
      }
      if (!xml.trim()) {
        throw new DocustreamRssFetchError('Feed payload is empty.', 502, 'empty_payload')
      }

      return xml
    }

    throw new DocustreamRssFetchError('Feed retrieval exceeded redirect limit.', 502, 'too_many_redirects')
  } catch (error) {
    if (error instanceof DocustreamRssFetchError) {
      throw error
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new DocustreamRssFetchError('Feed request timed out.', 504, 'timeout')
    }
    const message = error instanceof Error ? error.message : 'Feed retrieval failed.'
    throw new DocustreamRssFetchError(message, 502, 'fetch_failed')
  } finally {
    clearTimeout(timeoutHandle)
  }
}

/** Constant-time check that the request presents the configured internal API key. */
function hasValidInternalKey(req: IncomingMessage): boolean {
  if (!INTERNAL_API_KEY) return false
  const provided = req.headers['x-nz-internal-key']
  const value = Array.isArray(provided) ? provided[0] ?? '' : provided ?? ''
  const a = new TextEncoder().encode(value)
  const b = new TextEncoder().encode(INTERNAL_API_KEY)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function validateChallengeRequest(body: BootstrapChallengeRequest): void {
  if (!isNonEmpty(body.handle)) throw new Error('handle is required.')
  if (!isNonEmpty(body.webId)) throw new Error('webId is required.')
  if (!isNonEmpty(body.podUrl)) throw new Error('podUrl is required.')
}

function validateProvisionRequest(body: ProvisionRequest): void {
  if (!isNonEmpty(body.handle)) throw new Error('handle is required.')
  if (!isNonEmpty(body.podSlug)) throw new Error('podSlug is required.')
  if (!isNonEmpty(body.webId)) throw new Error('webId is required.')
  if (!isNonEmpty(body.podUrl)) throw new Error('podUrl is required.')
  if (!isNonEmpty(body.stellarPublicKey)) throw new Error('stellarPublicKey is required.')
  if (!isNonEmpty(body.identityContractId)) throw new Error('identityContractId is required.')
  if (!isNonEmpty(body.lockboxFactoryContractId)) throw new Error('lockboxFactoryContractId is required.')
  if (!isNonEmpty(body.challengeId)) throw new Error('challengeId is required.')
  if (!isNonEmpty(body.signatureBase64)) throw new Error('signatureBase64 is required.')
  if (body.proofVersion !== 1) throw new Error('proofVersion=1 is required.')
  if (!isNonEmpty(body.claimHash)) throw new Error('claimHash is required.')
  if (!isNonEmpty(body.proofHex)) throw new Error('proofHex is required.')
  if (!isNonEmpty(body.proofHashHex)) throw new Error('proofHashHex is required.')
  if (!isNonEmpty(body.proofRootHex)) throw new Error('proofRootHex is required.')
  if (!Array.isArray(body.publicSignals)) throw new Error('publicSignals is required.')
}

export async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req))
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(req, res, 200, {
      ok: true,
      service: 'jss-provisioner',
      envProfile: process.env.NZ_ENV_PROFILE ?? 'local',
      issuer: ISSUER,
      lockboxFactory: {
        mode: LOCKBOX_FACTORY_MODE,
        contractId: LOCKBOX_FACTORY_CONTRACT_ID || null,
      },
      solidAccount: {
        configured: Boolean(SOLID_CSS_BASE_URL),
        cssBaseUrl: SOLID_CSS_BASE_URL || null,
      },
      treasuryCreateAccount: {
        enabled: Boolean(INTERNAL_API_KEY),
      },
      notificationEvents: {
        mode: notificationPublisher.mode,
        webhookConfigured: Boolean((process.env.JSS_NOTIFICATION_WEBHOOK_URL ?? '').trim()),
      },
      uptimeMs: Math.round(process.uptime() * 1000),
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/bootstrap-challenge') {
    const body = await readJsonBody<BootstrapChallengeRequest>(req)
    validateChallengeRequest(body)
    const challenge = store.issueChallenge(body)
    sendJson(req, res, 200, challenge)
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/solid-account/check-email') {
    if (!SOLID_CSS_BASE_URL) {
      sendJson(req, res, 503, { error: 'Solid account provisioning is not configured (JSS_SOLID_CSS_BASE_URL).' })
      return
    }

    const body = await readJsonBody<{ email?: string }>(req)
    if (!isNonEmpty(body.email)) {
      sendJson(req, res, 400, { error: 'email is required.' })
      return
    }

    const email = normalizeEmail(body.email)
    if (!isValidEmail(email)) {
      sendJson(req, res, 400, { error: 'email must be a valid email address.' })
      return
    }

    sendJson(req, res, 200, {
      exists: knownSolidAccountEmails.has(email),
      source: 'provisioner-memory',
      checkedAt: new Date().toISOString(),
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/v1/community-directory/index') {
    sendJson(req, res, 200, communityDirectory.buildPublicIndex())
    return
  }

  if (
    req.method === 'POST' &&
    (url.pathname === '/v1/community-directory/opt-in' || url.pathname === '/v1/community-directory/opt-out')
  ) {
    if (!INTERNAL_API_KEY) {
      sendJson(req, res, 503, { error: 'Community directory mutation is not enabled (JSS_INTERNAL_API_KEY).' })
      return
    }
    if (!hasValidInternalKey(req)) {
      sendJson(req, res, 401, { error: 'A valid x-nz-internal-key header is required.' })
      return
    }

    const body = await readJsonBody<{ webId?: string }>(req)
    if (!isNonEmpty(body.webId)) {
      sendJson(req, res, 400, { error: 'webId is required.' })
      return
    }

    const listed = url.pathname.endsWith('/opt-in')
    const updated = communityDirectory.setListing(body.webId.trim(), listed)
    if (!updated) {
      sendJson(req, res, 404, { error: 'No directory record exists for the provided webId.' })
      return
    }

    sendJson(req, res, 200, {
      status: 'ok',
      listed,
      record: updated,
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/docustream/rss-fetch') {
    const body = await readJsonBody<{ url?: string }>(req)
    if (!isNonEmpty(body.url)) {
      sendJson(req, res, 400, { error: 'url is required.', code: 'missing_url' })
      return
    }

    try {
      const feedUrl = await validateDocustreamRssUrl(body.url)
      const xml = await fetchDocustreamRssXml(feedUrl)
      sendJson(req, res, 200, {
        url: feedUrl.toString(),
        xml,
      })
    } catch (error) {
      if (error instanceof DocustreamRssFetchError) {
        sendJson(req, res, error.statusCode, { error: error.message, code: error.errorCode })
        return
      }
      const message = error instanceof Error ? error.message : 'Feed retrieval failed.'
      sendJson(req, res, 502, { error: message, code: 'fetch_failed' })
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/solid-account') {
    if (!SOLID_CSS_BASE_URL) {
      sendJson(req, res, 503, { error: 'Solid account provisioning is not configured (JSS_SOLID_CSS_BASE_URL).' })
      return
    }
    const cssConsumerOrigin = toOrigin(SOLID_CSS_BASE_URL)
    if (!cssConsumerOrigin) {
      sendJson(req, res, 503, { error: 'Solid account provisioning has an invalid CSS base URL.' })
      return
    }

    const body = await readJsonBody<{
      name?: string
      email?: string
      password?: string
      stellarPublicKey?: string
      accountCommitmentHex?: string
      ciphertextHex?: string
    }>(req)
    if (!isNonEmpty(body.name)) {
      sendJson(req, res, 400, { error: 'name is required.' })
      return
    }
    if (!isNonEmpty(body.email)) {
      sendJson(req, res, 400, { error: 'email is required.' })
      return
    }
    if (!isNonEmpty(body.password)) {
      sendJson(req, res, 400, { error: 'password is required.' })
      return
    }
    // Fail-closed: seamless onboarding must anchor the WebID<->Stellar pairing
    // in a per-user lockb0x on-chain, which requires the member's Stellar public
    // key. Reject requests that omit it so an un-anchored account can never be
    // created (previously a missing key silently skipped lockbox provisioning).
    if (!isNonEmpty(body.stellarPublicKey)) {
      sendJson(req, res, 400, { error: 'stellarPublicKey is required.' })
      return
    }

    const stellarPublicKey = body.stellarPublicKey.trim()
    if (!/^G[A-Z2-7]{55}$/.test(stellarPublicKey)) {
      sendJson(req, res, 400, { error: 'stellarPublicKey must be a valid Stellar public key (G...).' })
      return
    }

    const normalizedName = body.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!normalizedName) {
      sendJson(req, res, 400, { error: 'name must contain alphanumeric characters.' })
      return
    }

    try {
      const email = normalizeEmail(body.email)
      const password = body.password.trim()
      let treasuryFunded = false
      if (!isValidEmail(email)) {
        sendJson(req, res, 400, { error: 'email must be a valid email address.' })
        return
      }
      if (!isValidProvisioningPassword(password)) {
        sendJson(req, res, 400, { error: 'password must be at least 12 characters.' })
        return
      }
      if (knownSolidAccountEmails.has(email)) {
        sendJson(req, res, 409, { error: 'There already is a login for this e-mail address.' })
        return
      }
      const account = await createSolidAccount(SOLID_CSS_BASE_URL, {
        name: normalizedName,
        email,
        password,
      })
      communityDirectory.seedRecord({
        webId: account.webId,
        podUrl: account.podUrl,
        issuer: ISSUER,
      })
      rememberKnownSolidEmail(email)

      // P3: on MainNet there is no Friendbot, so the member's Stellar account
      // must be Treasury-funded before they can author on-chain operations
      // (e.g. register_webid). Idempotent + fail-closed: a funding failure aborts
      // onboarding so we never hand back an account the member cannot use.
      if (TREASURY_FUND_MEMBERS) {
        try {
          await treasuryCreateAccount(stellarPublicKey)
          treasuryFunded = true
        } catch (fundErr) {
          const message = fundErr instanceof Error ? fundErr.message : 'Treasury member funding failed.'
          sendJson(req, res, 502, { error: message, webId: account.webId, podUrl: account.podUrl })
          emitLifecycleEvent('account.treasury-funding.failed', {
            webId: account.webId,
            podUrl: account.podUrl,
            stellarPublicKey,
            metadata: {
              reason: message,
            },
          })
          return
        }
      }

      // Optionally anchor the WebID<->Stellar pairing in a per-user lockb0x.
      // Requested by supplying stellarPublicKey; fail-closed when requested.
      let lockbox: Awaited<ReturnType<typeof store.provisionLockbox>> | undefined
      if (stellarPublicKey) {
        const podBindingHash = createHash('sha256')
          .update(`${account.webId}|${stellarPublicKey}`)
          .digest('hex')
        const proofRootHex = createHash('sha256')
          .update(`NZ_POD_PAIR_V1|${account.webId}|${stellarPublicKey}|${account.podUrl}`)
          .digest('hex')
        lockbox = await store.provisionLockbox({
          webId: account.webId,
          stellarPublicKey,
          podBindingHash,
          proofRootHex,
        })
        if (lockbox.status !== 'ready' || !lockbox.userLockboxContractId) {
          sendJson(req, res, 502, {
            error: lockbox.error ?? 'Per-user lockb0x anchoring failed.',
            webId: account.webId,
            podUrl: account.podUrl,
          })
          return
        }
      }

      // Phase E: anchor the REAL ZK attestation — the identity commitment
      // (Poseidon(identitySecret)) plus the Stellar-encrypted claim ciphertext —
      // into the lockb0x via `set_attestation` (Deployer = operator). The client
      // produces these on-device from a verified `pod_ownership` proof. This
      // replaces the earlier sha256 pairing root as the authoritative anchor.
      // Fail-closed when supplied: onboarding must not complete half-anchored.
      let attestation: { accountCommitmentHex: string; ciphertextSha256Hex: string } | null = null
      const accountCommitmentHex = typeof body.accountCommitmentHex === 'string' ? body.accountCommitmentHex.trim() : ''
      const ciphertextHex = typeof body.ciphertextHex === 'string' ? body.ciphertextHex.trim() : ''
      if (lockbox?.userLockboxContractId && accountCommitmentHex && ciphertextHex) {
        try {
          await anchorAttestation(lockbox.userLockboxContractId, accountCommitmentHex, ciphertextHex)
          attestation = {
            accountCommitmentHex: accountCommitmentHex.toLowerCase().replace(/^0x/, ''),
            ciphertextSha256Hex: createHash('sha256')
              .update(Buffer.from(ciphertextHex.replace(/^0x/, ''), 'hex'))
              .digest('hex'),
          }
        } catch (anchorErr) {
          const message = anchorErr instanceof Error ? anchorErr.message : 'Attestation anchoring failed.'
          sendJson(req, res, 502, { error: message, webId: account.webId, podUrl: account.podUrl })
          return
        }
      }

      // Persist the account profile (WebID <-> Stellar pairing + on-chain
      // lockb0x references) into the user's own Pod, so the data lives with the
      // user from creation. Best-effort: the on-chain lockb0x remains the source
      // of truth, so a transient Pod write failure does not fail onboarding.
      const accountRecord = {
        version: 1,
        type: 'nodezero-account',
        webId: account.webId,
        podUrl: account.podUrl,
        stellarPublicKey: stellarPublicKey || null,
        issuer: ISSUER,
        envProfile: process.env.NZ_ENV_PROFILE ?? 'local',
        lockbox: lockbox
          ? {
              userLockboxContractId: lockbox.userLockboxContractId,
              factoryContractId: lockbox.factoryContractId,
              proofRootHex: lockbox.proofRootHex,
            }
          : null,
        attestation,
        createdAt: new Date().toISOString(),
      }
      let accountDocumentUrl: string | null = null
      try {
        accountDocumentUrl = await writePodAccountDocument(
          SOLID_CSS_BASE_URL,
          { id: account.clientCredentialsId, secret: account.clientCredentialsSecret },
          account.podUrl,
          accountRecord,
        )
      } catch (writeErr) {
        // Surface in logs but do not fail onboarding; the lockb0x is authoritative.
        console.warn('[solid-account] Pod account document write failed:', writeErr)
      }

      // Allocate + fill the WebID profile-card anchor slot with the on-chain
      // bindings (lockb0x, Stellar account, ZK identity commitment) so the
      // attestation is discoverable from the WebID. Best-effort: the on-chain
      // lockb0x remains authoritative, so a PATCH failure does not fail onboarding.
      if (attestation && lockbox?.userLockboxContractId) {
        try {
          await patchPodProfileAnchor(
            SOLID_CSS_BASE_URL,
            { id: account.clientCredentialsId, secret: account.clientCredentialsSecret },
            account.webId,
            {
              lockboxContractId: lockbox.userLockboxContractId,
              stellarPublicKey,
              accountCommitmentHex: attestation.accountCommitmentHex,
            },
          )
        } catch (patchErr) {
          console.warn('[solid-account] Pod profile-card anchor PATCH failed:', patchErr)
        }
      }

      sendJson(req, res, 200, {
        status: 'ready',
        webId: account.webId,
        podUrl: account.podUrl,
        stellarPublicKey: stellarPublicKey || null,
        accountDocumentUrl,
        oidcBridge: {
          ...store.issueOidcBridgeTicket({
            email,
            password,
            webId: account.webId,
            podUrl: account.podUrl,
            audience: OIDC_BRIDGE_AUDIENCE,
            consumerOrigin: cssConsumerOrigin,
            issuer: ISSUER,
          }),
          consumeUrl: `${PUBLIC_PROVISIONER_BASE_URL}/v1/oidc-bridge/consume`,
        },
        lockbox: lockbox ?? null,
        attestation,
      })

      emitLifecycleEvent('account.created', {
        webId: account.webId,
        podUrl: account.podUrl,
        stellarPublicKey,
        ...(lockbox?.userLockboxContractId
          ? { lockboxContractId: lockbox.userLockboxContractId }
          : {}),
        metadata: {
          accountDocumentWritten: Boolean(accountDocumentUrl),
          treasuryFunded,
          attestationAnchored: Boolean(attestation),
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Solid account provisioning failed.'
      if (isDuplicateEmailProvisioningMessage(message) && isNonEmpty(body.email)) {
        rememberKnownSolidEmail(body.email)
        sendJson(req, res, 409, { error: 'There already is a login for this e-mail address.' })
        return
      }
      sendJson(req, res, 502, { error: message })
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/oidc-bridge/consume') {
    const body = await readJsonBody<{ token?: string; audience?: string }>(req)
    if (!isNonEmpty(body.token)) {
      sendJson(req, res, 400, { error: 'token is required.' })
      return
    }
    if (!isNonEmpty(body.audience)) {
      sendJson(req, res, 400, { error: 'audience is required.' })
      return
    }

    const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : ''
    if (!requestOrigin) {
      sendJson(req, res, 400, { error: 'origin header is required.' })
      return
    }

    const ticket = store.consumeOidcBridgeTicket({
      token: body.token,
      audience: body.audience,
      consumerOrigin: requestOrigin,
      issuer: ISSUER,
    })
    if (!ticket) {
      sendJson(req, res, 400, { error: 'OIDC bridge token is invalid or expired.' })
      return
    }

    sendJson(req, res, 200, {
      email: ticket.email,
      password: ticket.password,
      webId: ticket.webId,
      podUrl: ticket.podUrl,
      expiresAt: ticket.expiresAt,
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/create-account') {
    // P3: Treasury-sponsored member account creation. Privileged, funds-moving,
    // and disabled unless an internal API key is configured (fail-closed).
    if (!INTERNAL_API_KEY) {
      sendJson(req, res, 503, { error: 'Treasury account creation is not enabled (JSS_INTERNAL_API_KEY).' })
      return
    }
    if (!hasValidInternalKey(req)) {
      sendJson(req, res, 401, { error: 'A valid x-nz-internal-key header is required.' })
      return
    }

    const body = await readJsonBody<{ stellarPublicKey?: string; startingBalanceXlm?: number }>(req)
    if (!isNonEmpty(body.stellarPublicKey)) {
      sendJson(req, res, 400, { error: 'stellarPublicKey is required.' })
      return
    }
    const destination = body.stellarPublicKey.trim()
    if (!/^G[A-Z2-7]{55}$/.test(destination)) {
      sendJson(req, res, 400, { error: 'stellarPublicKey must be a valid Stellar public key (G...).' })
      return
    }

    try {
      const result = await treasuryCreateAccount(destination, body.startingBalanceXlm)
      sendJson(req, res, 200, { status: 'ok', ...result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Treasury account creation failed.'
      sendJson(req, res, 502, { error: message })
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/provision') {
    const body = await readJsonBody<ProvisionRequest>(req)
    validateProvisionRequest(body)

    const challenge = store.consumeChallenge(body.challengeId)
    if (!challenge) {
      sendJson(req, res, 400, { error: 'Challenge is invalid or expired.' })
      return
    }

    const jobId = store.createPendingJob()

    try {
      const receipt = verifyAttestation(body, challenge)
      const lockbox = await store.provisionLockbox({
        webId: body.webId,
        stellarPublicKey: body.stellarPublicKey,
        podBindingHash: receipt.podBindingHash,
        proofRootHex: receipt.proofRootHex,
      })

      if (
        lockbox.status !== 'ready' ||
        lockbox.mode !== 'soroban' ||
        !lockbox.userLockboxContractId
      ) {
        throw new Error(lockbox.error ?? 'Per-user lockbox provisioning failed.')
      }

      store.resolveJob(jobId, {
        handle: body.handle.trim(),
        webId: body.webId.trim(),
        podUrl: body.podUrl.trim(),
        issuer: ISSUER,
        stellarPublicKey: body.stellarPublicKey.trim(),
        challengeId: challenge.challengeId,
        claimHash: receipt.claimHash,
        proofHashHex: receipt.proofHashHex,
        proofRootHex: receipt.proofRootHex,
        lockbox,
      })

      const result: ProvisionResult = {
        status: 'ready',
        jobId,
        lockbox,
      }

      sendJson(req, res, 200, {
        ...result,
        challengeMessage: receipt.challengeMessage,
        podBindingHash: receipt.podBindingHash,
        canonicalClaim: receipt.canonicalClaim,
        claimHash: receipt.claimHash,
        proofHashHex: receipt.proofHashHex,
        proofRootHex: receipt.proofRootHex,
      })

      emitLifecycleEvent('provision.ready', {
        webId: body.webId.trim(),
        podUrl: body.podUrl.trim(),
        stellarPublicKey: body.stellarPublicKey.trim(),
        lockboxContractId: lockbox.userLockboxContractId,
        metadata: {
          challengeId: challenge.challengeId,
          claimHash: receipt.claimHash,
          proofHashHex: receipt.proofHashHex,
          proofRootHex: receipt.proofRootHex,
        },
      })
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Provisioning verification failed.'
      store.failJob(jobId, message)
      sendJson(req, res, 400, { error: message, jobId })
      return
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/v1/provision/')) {
    const jobId = url.pathname.replace('/v1/provision/', '').trim()
    if (!jobId) {
      sendJson(req, res, 400, { error: 'Missing jobId.' })
      return
    }

    const status = store.getJob(jobId)
    if (!status) {
      sendJson(req, res, 404, { error: 'Provision job not found.' })
      return
    }

    sendJson(req, res, 200, status)
    return
  }

  sendJson(req, res, 404, { error: 'Not found' })
}

export function createRequestHandler() {
  return (req: IncomingMessage, res: ServerResponse): void => {
    handleHttpRequest(req, res).catch((err) => {
      const message = err instanceof Error ? err.message : 'Unhandled server error.'
      sendJson(req, res, 500, { error: message })
    })
  }
}

function isEntrypoint(): boolean {
  return typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module
}

if (isEntrypoint()) {
  const server = createServer(createRequestHandler())
  server.listen(PORT, () => {
    console.log(`[jss-provisioner] listening on :${PORT}`)
  })
}
