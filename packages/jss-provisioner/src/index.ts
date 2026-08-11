import { createServer } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { subtle } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ProvisionStore } from './store.js'
import { verifyAttestation } from './attestation.js'
import {
  createSolidAccount,
  mintPodAccessToken,
  patchPodProfileAnchor,
  probePodAccess,
  writePodAccountDocument,
} from './solidAccount.js'
import { ConditionalWriteError, CredentialStore } from './credentialStore.js'
import {
  computeProvisioningRequestDigest,
  ProvisioningConflictError,
  ProvisioningStore,
  type ProvisioningLease,
  type VersionedProvisioningOperation,
} from './provisioningStore.js'
import { SessionTokenManager } from './sessionTokens.js'
import { handlePodProxyRequest, POD_PROXY_PREFIX, evictPodTokenCache } from './podProxy.js'
import { treasuryCreateAccount } from './treasuryCreateAccount.js'
import { anchorAttestation } from './attestationAnchor.js'
import {
  createNotificationEventPublisherFromEnv,
  publishProvisioningEvent,
} from './notificationEvents.js'
import { CommunityDirectoryStore, type CommunityDirectoryRecord } from './communityDirectory.js'
import { AzureTableCommunityDirectoryPersistence } from './communityDirectoryPersistence.js'
import type { BridgeProofPayload } from './lockboxFactory.js'
import { verifyBridgeProof } from './bridgeProofVerifier.js'
import { buildPodOwnershipClaim } from './podOwnershipClaim.js'
import { RelationshipDeliveryError, deliverRelationshipActivity } from './relationshipDelivery.js'
import {
  readRelationshipDeliveryAssertion,
  RelationshipDeliveryAssertionManager,
} from './relationshipDeliveryAssertions.js'
import { RelationshipRateLimiter } from './relationshipRateLimiter.js'
import { isRelationshipRecipientBlocked } from './relationshipBlockPolicy.js'
import {
  CommunityDirectoryRefreshError,
  refreshCommunityDirectoryProjection,
} from './communityDirectoryRefresh.js'
import { PublicPeerProfileError, readPublicPeerProfile } from './publicPeerProfile.js'
import {
  isTransportIdentityAudience,
  TransportIdentityAssertionManager,
} from './transportIdentityAssertions.js'
import { createMilestoneQControlsFromEnv } from './milestoneQControls.js'
import { fetchPublicResource, PublicResourceFetchError } from './publicResourceFetcher.js'
// Stellar StrKey base32 decode + Ed25519 verify using Web Crypto API
const _B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function _b32Decode(s: string): Uint8Array {
  const out: number[] = []
  let bits = 0,
    val = 0
  for (const c of s.toUpperCase()) {
    if (c === '=') break
    const i = _B32.indexOf(c)
    if (i < 0) throw new Error('Invalid base32 char: ' + c)
    val = (val << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}
async function verifyStellarEd25519(
  pubKeyStrKey: string,
  message: string,
  signatureBase64: string
): Promise<boolean> {
  try {
    const decoded = _b32Decode(pubKeyStrKey)
    if (decoded.length < 33) return false
    // Stellar StrKey: byte[0] = versionByte << 3, bytes[1..32] = raw 32-byte Ed25519 key
    const rawKey = decoded.slice(1, 33)
    const sig = Buffer.from(signatureBase64, 'base64')
    const msgBytes = Buffer.from(message, 'utf8')
    const key = await subtle.importKey('raw', rawKey, { name: 'Ed25519' }, false, ['verify'])
    return await subtle.verify({ name: 'Ed25519' }, key, sig, msgBytes)
  } catch {
    return false
  }
}
import type {
  BootstrapChallengeRequest,
  ProvisionRequest,
  ProvisionResult,
  StellarChallengeRequest,
  StellarTokenRequest,
  LockboxProvisioning,
} from './types.js'
import type { CreateSolidAccountResult } from './solidAccount.js'

const PORT = Number(process.env.PORT ?? process.env.JSS_PROVISIONER_PORT ?? 8181)
const ISSUER = process.env.JSS_ISSUER_URL ?? 'https://staging.nodezero.social'
const SOLID_CSS_BASE_URL = (process.env.JSS_SOLID_CSS_BASE_URL ?? '').trim().replace(/\/+$/, '')
const LOCKBOX_FACTORY_CONTRACT_ID =
  process.env.JSS_LOCKBOX_FACTORY_CONTRACT_ID ?? process.env.NZ_LOCKBOX_FACTORY_CONTRACT_ID ?? ''
const LOCKBOX_FACTORY_MODE = (process.env.JSS_LOCKBOX_FACTORY_MODE ?? 'mock').toLowerCase()
const LOCKBOX_FACTORY_VERSION = (process.env.JSS_LOCKBOX_FACTORY_VERSION ?? 'v2')
  .trim()
  .toLowerCase()
const LOCKBOX_BRIDGE_V3_VK_URL = (process.env.JSS_LOCKBOX_BRIDGE_V3_VK_URL ?? '').trim()
const LOCKBOX_BRIDGE_V3_MANIFEST_URL = (process.env.JSS_LOCKBOX_BRIDGE_V3_MANIFEST_URL ?? '').trim()
const LOCKBOX_BRIDGE_V3_MANIFEST_SHA256 = (process.env.JSS_LOCKBOX_BRIDGE_V3_MANIFEST_SHA256 ?? '')
  .trim()
  .toLowerCase()
const LOCKBOX_BRIDGE_V3_WASM_URL = (process.env.JSS_LOCKBOX_BRIDGE_V3_WASM_URL ?? '').trim()
const LOCKBOX_BRIDGE_V3_WASM_SHA256 = (process.env.JSS_LOCKBOX_BRIDGE_V3_WASM_SHA256 ?? '')
  .trim()
  .toLowerCase()
const LOCKBOX_BRIDGE_V3_ZKEY_URL = (process.env.JSS_LOCKBOX_BRIDGE_V3_ZKEY_URL ?? '').trim()
const LOCKBOX_BRIDGE_V3_ZKEY_SHA256 = (process.env.JSS_LOCKBOX_BRIDGE_V3_ZKEY_SHA256 ?? '')
  .trim()
  .toLowerCase()
const LOCKBOX_BRIDGE_V3_VK_SHA256 = (process.env.JSS_LOCKBOX_BRIDGE_V3_VK_SHA256 ?? '')
  .trim()
  .toLowerCase()
interface EmbeddedBuildInfo {
  commit: string
  payloadSha256: string
}

function readEmbeddedBuildInfo(): EmbeddedBuildInfo {
  try {
    const parsed = JSON.parse(
      readFileSync(join(__dirname, 'build-info.json'), 'utf8')
    ) as Partial<EmbeddedBuildInfo>
    if (
      typeof parsed.commit === 'string' &&
      parsed.commit.trim() &&
      typeof parsed.payloadSha256 === 'string' &&
      /^[0-9a-f]{64}$/i.test(parsed.payloadSha256)
    ) {
      return { commit: parsed.commit.trim(), payloadSha256: parsed.payloadSha256.toLowerCase() }
    }
  } catch {
    // Local tests and development builds do not require an embedded marker.
  }
  return {
    commit: (process.env.JSS_BUILD_COMMIT ?? 'unknown').trim(),
    payloadSha256: (process.env.JSS_BUILD_PAYLOAD_SHA256 ?? 'unknown').trim().toLowerCase(),
  }
}

const EMBEDDED_BUILD = readEmbeddedBuildInfo()
const CONFIGURED_ARTIFACT_SHA256 = (process.env.JSS_BUILD_ARTIFACT_SHA256 ?? 'unknown')
  .trim()
  .toLowerCase()
const BN254_SCALAR_FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n
const BROWSER_SESSION_ENABLED = /^(1|true|yes)$/i.test(
  (process.env.JSS_BROWSER_SESSION_ENABLED ?? '').trim()
)
const BROWSER_SESSION_COOKIE_NAME = (
  process.env.JSS_BROWSER_SESSION_COOKIE_NAME ?? '__Host-nz_browser_session'
).trim()
const BROWSER_SESSION_TTL_MS = Number(
  process.env.JSS_BROWSER_SESSION_TTL_MS ?? 30 * 24 * 60 * 60_000
)
// P3: Treasury-sponsored member account creation is a privileged, funds-moving
// operation. It is disabled unless an internal API key is configured, and every
// request must present it (fail-closed). This prevents an open endpoint from
// draining the Treasury by creating accounts for arbitrary fresh keys.
const INTERNAL_API_KEY = (process.env.JSS_INTERNAL_API_KEY ?? '').trim()
// P3: when enabled, the provisioner funds each member's Stellar account from the
// Treasury during onboarding (replacing testnet Friendbot on MainNet, where no
// faucet exists). Off by default to preserve the testnet Friendbot self-funding
// path; enable via JSS_TREASURY_FUND_MEMBERS=1 for MainNet readiness.
const TREASURY_FUND_MEMBERS = /^(1|true|yes)$/i.test(
  (process.env.JSS_TREASURY_FUND_MEMBERS ?? '').trim()
)
const COMMUNITY_DIRECTORY_STORE_PATH =
  (process.env.JSS_COMMUNITY_DIRECTORY_STORE_PATH ?? '').trim() ||
  join(tmpdir(), `nz-community-directory-${process.pid}.json`)
const COMMUNITY_DIRECTORY_TABLE_SAS_URL = (
  process.env.JSS_COMMUNITY_DIRECTORY_TABLE_SAS_URL ??
  process.env.JSS_CREDENTIALS_TABLE_SAS_URL ??
  ''
).trim()
const ALLOWED_ORIGINS = (
  process.env.JSS_ALLOWED_ORIGINS ??
  'https://staging.nodezero.social,https://nodezero.social,https://www.nodezero.social,https://solid.nodezero.social,http://localhost:19006,http://localhost:8081'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)
const store = new ProvisionStore()
const communityDirectory = new CommunityDirectoryStore({
  persistenceFilePath: COMMUNITY_DIRECTORY_STORE_PATH,
  ...(COMMUNITY_DIRECTORY_TABLE_SAS_URL
    ? {
        persistence: new AzureTableCommunityDirectoryPersistence(COMMUNITY_DIRECTORY_TABLE_SAS_URL),
      }
    : {}),
})
const credentialStore = new CredentialStore()
const provisioningStore = new ProvisioningStore(credentialStore)
const sessions = new SessionTokenManager({ issuer: ISSUER })
const relationshipDeliveryAssertions = new RelationshipDeliveryAssertionManager({ issuer: ISSUER })
const transportIdentityAssertions = new TransportIdentityAssertionManager({ issuer: ISSUER })
const milestoneQControls = createMilestoneQControlsFromEnv()
const relationshipDeliveryRateLimiter = new RelationshipRateLimiter({
  maxRequests: Number(process.env.JSS_RELATIONSHIP_DELIVERY_RATE_LIMIT ?? 30),
  windowMs: Number(process.env.JSS_RELATIONSHIP_DELIVERY_RATE_WINDOW_MS ?? 60_000),
})
const relationshipVerificationRateLimiter = new RelationshipRateLimiter({
  maxRequests: Number(process.env.JSS_RELATIONSHIP_VERIFY_RATE_LIMIT ?? 120),
  windowMs: Number(process.env.JSS_RELATIONSHIP_VERIFY_RATE_WINDOW_MS ?? 60_000),
})
const communityDirectoryRefreshRateLimiter = new RelationshipRateLimiter({
  maxRequests: Number(process.env.JSS_COMMUNITY_DIRECTORY_REFRESH_RATE_LIMIT ?? 12),
  windowMs: Number(process.env.JSS_COMMUNITY_DIRECTORY_REFRESH_RATE_WINDOW_MS ?? 60_000),
})
const communityDirectorySuppressRateLimiter = new RelationshipRateLimiter({
  maxRequests: Number(process.env.JSS_COMMUNITY_DIRECTORY_SUPPRESS_RATE_LIMIT ?? 60),
  windowMs: Number(process.env.JSS_COMMUNITY_DIRECTORY_SUPPRESS_RATE_WINDOW_MS ?? 60_000),
})
const communityDirectoryIndexRateLimiter = new RelationshipRateLimiter({
  maxRequests: Number(process.env.JSS_COMMUNITY_DIRECTORY_INDEX_RATE_LIMIT ?? 60),
  windowMs: Number(process.env.JSS_COMMUNITY_DIRECTORY_INDEX_RATE_WINDOW_MS ?? 60_000),
})
const communityDirectoryAvatarRateLimiter = new RelationshipRateLimiter({
  maxRequests: Number(process.env.JSS_COMMUNITY_DIRECTORY_AVATAR_RATE_LIMIT ?? 120),
  windowMs: Number(process.env.JSS_COMMUNITY_DIRECTORY_AVATAR_RATE_WINDOW_MS ?? 60_000),
})
const COMMUNITY_DIRECTORY_AVATAR_MAX_CONCURRENCY = positiveIntegerEnvironment(
  'JSS_COMMUNITY_DIRECTORY_AVATAR_MAX_CONCURRENCY',
  8
)
let communityDirectoryAvatarActiveRequests = 0
const COMMUNITY_DIRECTORY_REFRESH_MAX_CONCURRENCY = positiveIntegerEnvironment(
  'JSS_COMMUNITY_DIRECTORY_REFRESH_MAX_CONCURRENCY',
  4
)
let communityDirectoryRefreshActiveRequests = 0
const publicProfileReadRateLimiter = new RelationshipRateLimiter({
  maxRequests: Number(process.env.JSS_PUBLIC_PROFILE_RATE_LIMIT ?? 30),
  windowMs: Number(process.env.JSS_PUBLIC_PROFILE_RATE_WINDOW_MS ?? 60_000),
})
const PUBLIC_PROFILE_MAX_CONCURRENCY = positiveIntegerEnvironment(
  'JSS_PUBLIC_PROFILE_MAX_CONCURRENCY',
  4
)
const publicProfileActiveRequests = new Map<string, number>()
const transportVerificationRateLimiter = new RelationshipRateLimiter({
  maxRequests: Number(process.env.JSS_TRANSPORT_VERIFY_RATE_LIMIT ?? 600),
  windowMs: Number(process.env.JSS_TRANSPORT_VERIFY_RATE_WINDOW_MS ?? 60_000),
})
const TRANSPORT_VERIFY_MAX_CONCURRENCY = positiveIntegerEnvironment(
  'JSS_TRANSPORT_VERIFY_MAX_CONCURRENCY',
  64
)
let transportVerificationActiveRequests = 0
const RELATIONSHIP_ASSERTIONS_READY =
  (process.env.NZ_ENV_PROFILE ?? 'local') === 'local' ||
  !relationshipDeliveryAssertions.usesEphemeralKey
const TRANSPORT_IDENTITY_READY =
  (process.env.NZ_ENV_PROFILE ?? 'local') === 'local' ||
  !transportIdentityAssertions.usesEphemeralKey

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return value
}

export interface RequestHandlerOverrides {
  isRelationshipRecipientBlocked?: typeof isRelationshipRecipientBlocked
  refreshCommunityDirectoryProjection?: typeof refreshCommunityDirectoryProjection
  reloadCommunityDirectory?: () => Promise<void>
  readPublicPeerProfile?: typeof readPublicPeerProfile
  fetchDirectoryAvatar?: typeof fetchPublicResource
  readDirectoryRecord?: (webId: string) => Promise<CommunityDirectoryRecord | null>
  readPodProxyPublicationConsent?: (webId: string) => Promise<{
    publicationRevision?: number
    publicListing: boolean
    publicIndexing: boolean
  }>
  getPodProxySuppressionRevision?: (webId: string) => Promise<number | null>
}
const knownSolidAccountEmails = new Set<string>()
const notificationPublisher = createNotificationEventPublisherFromEnv()
const DOCUSTREAM_RSS_FETCH_TIMEOUT_MS = Number(
  process.env.JSS_DOCUSTREAM_RSS_FETCH_TIMEOUT_MS ?? 12000
)
const DOCUSTREAM_RSS_MAX_BYTES = Number(process.env.JSS_DOCUSTREAM_RSS_MAX_BYTES ?? 1_000_000)
const DOCUSTREAM_RSS_MAX_REDIRECTS = Number(process.env.JSS_DOCUSTREAM_RSS_MAX_REDIRECTS ?? 3)
const DOCUSTREAM_ALLOWED_CONTENT_TYPES = [
  'application/rss+xml',
  'application/xml',
  'text/xml',
  'application/atom+xml',
]
const STELLAR_AUTH_AUDIENCE = 'nz-css-stellar-login-v1'
const PROVISIONING_LEASE_TTL_MS = Number(process.env.JSS_PROVISIONING_LEASE_TTL_MS ?? 5 * 60_000)

interface SolidAccountResumeMaterial {
  password?: string
  account?:
    | CreateSolidAccountResult
    | {
        webId: string
        podUrl: string
      }
  lockbox?: LockboxProvisioning
  attestation?: { accountCommitmentHex: string; ciphertextSha256Hex: string } | null
  accountDocumentUrl?: string | null
  treasuryFunded?: boolean
}

class DocustreamRssFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly errorCode: string
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

/**
 * Generates the ephemeral CSS account password. It exists only because the
 * CSS account API requires one; it is discarded immediately after client
 * credentials are minted and is never stored, returned, or user-visible.
 * The user's sole credential is their Stellar keypair.
 */
function generateEphemeralCssPassword(): string {
  return randomBytes(24).toString('base64url')
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
  const isAllowedOrigin = isAllowedBrowserOrigin(req)
  const allowOrigin = isAllowedOrigin ? origin! : (ALLOWED_ORIGINS[0] ?? '*')

  return {
    'access-control-allow-origin': allowOrigin,
    ...(isAllowedOrigin ? { 'access-control-allow-credentials': 'true' } : {}),
    'access-control-allow-methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers':
      'content-type,authorization,idempotency-key,x-nz-internal-key,x-nodezero-publication-revision,accept,if-match,if-none-match,slug,link',
    'access-control-expose-headers': 'etag,location,link,wac-allow,accept-patch,allow',
    vary: 'origin',
  }
}

function isAllowedBrowserOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  return typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin)
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  extraHeaders: Record<string, string | string[]> = {}
): void {
  res.writeHead(statusCode, {
    ...corsHeaders(req),
    ...extraHeaders,
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(payload))
}

interface OnboardingConfigDescriptor {
  schemaVersion: number
  claimDomain: string
  circuitVersion: number
  envProfile: string
  networkPassphrase: string
  issuer: string
  solidPodOrigin: string
  provisionerOrigin: string
  appOrigin: string
  identityContractId: string
  lockboxFactoryContractId: string
  lockboxFactoryVersion: string
  artifacts: {
    manifest: { url: string; sha256: string }
    wasm: { url: string; sha256: string }
    zkey: { url: string; sha256: string }
    verificationKey: { url: string; sha256: string }
  }
  ready: boolean
  configFingerprint: string
}

function buildOnboardingConfigDescriptor(): OnboardingConfigDescriptor {
  const envProfile = (process.env.NZ_ENV_PROFILE ?? 'local').trim()
  const networkPassphrase = (
    process.env.JSS_STELLAR_NETWORK_PASSPHRASE ??
    process.env.NZ_STELLAR_NETWORK_PASSPHRASE ??
    'Test SDF Network ; September 2015'
  ).trim()
  const identityContractId = (
    process.env.JSS_IDENTITY_CONTRACT_ID ??
    process.env.NZ_IDENTITY_CONTRACT_ID ??
    ''
  ).trim()
  const provisionerOrigin = (process.env.JSS_PUBLIC_PROVISIONER_BASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '')
  const appOrigin = (process.env.JSS_APP_ORIGIN ?? '').trim().replace(/\/+$/, '')
  const fingerprintInput = {
    schemaVersion: 1,
    claimDomain: 'NZ_POD_STELLAR_BRIDGE_V3',
    circuitVersion: 3,
    envProfile,
    networkPassphrase,
    issuer: ISSUER.replace(/\/+$/, ''),
    solidPodOrigin: SOLID_CSS_BASE_URL,
    provisionerOrigin,
    appOrigin,
    identityContractId,
    lockboxFactoryContractId: LOCKBOX_FACTORY_CONTRACT_ID.trim(),
    lockboxFactoryVersion: LOCKBOX_FACTORY_VERSION,
    artifacts: {
      manifest: { url: LOCKBOX_BRIDGE_V3_MANIFEST_URL, sha256: LOCKBOX_BRIDGE_V3_MANIFEST_SHA256 },
      wasm: { url: LOCKBOX_BRIDGE_V3_WASM_URL, sha256: LOCKBOX_BRIDGE_V3_WASM_SHA256 },
      zkey: { url: LOCKBOX_BRIDGE_V3_ZKEY_URL, sha256: LOCKBOX_BRIDGE_V3_ZKEY_SHA256 },
      verificationKey: { url: LOCKBOX_BRIDGE_V3_VK_URL, sha256: LOCKBOX_BRIDGE_V3_VK_SHA256 },
    },
  }
  const requiredValues = [
    envProfile,
    networkPassphrase,
    fingerprintInput.issuer,
    SOLID_CSS_BASE_URL,
    provisionerOrigin,
    appOrigin,
    identityContractId,
    fingerprintInput.lockboxFactoryContractId,
    LOCKBOX_BRIDGE_V3_MANIFEST_URL,
    LOCKBOX_BRIDGE_V3_MANIFEST_SHA256,
    LOCKBOX_BRIDGE_V3_WASM_URL,
    LOCKBOX_BRIDGE_V3_WASM_SHA256,
    LOCKBOX_BRIDGE_V3_ZKEY_URL,
    LOCKBOX_BRIDGE_V3_ZKEY_SHA256,
    LOCKBOX_BRIDGE_V3_VK_URL,
    LOCKBOX_BRIDGE_V3_VK_SHA256,
  ]
  const ready =
    LOCKBOX_FACTORY_VERSION === 'v3' &&
    requiredValues.every((value) => value.length > 0) &&
    [
      LOCKBOX_BRIDGE_V3_MANIFEST_SHA256,
      LOCKBOX_BRIDGE_V3_WASM_SHA256,
      LOCKBOX_BRIDGE_V3_ZKEY_SHA256,
      LOCKBOX_BRIDGE_V3_VK_SHA256,
    ].every((value) => /^[0-9a-f]{64}$/.test(value))
  const configFingerprint = createHash('sha256')
    .update(JSON.stringify(fingerprintInput), 'utf8')
    .digest('hex')

  return { ...fingerprintInput, ready, configFingerprint }
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie ?? ''
  for (const entry of raw.split(';')) {
    const [key, ...rest] = entry.trim().split('=')
    if (key === name) return rest.join('=') || null
  }
  return null
}

const LEGACY_BROWSER_SESSION_COOKIE_CLEAR =
  'nz_browser_session=; Path=/; Domain=.nodezero.social; Max-Age=0; HttpOnly; Secure; SameSite=Lax'

function clearBrowserSessionCookie(): Record<string, string[]> {
  return {
    'set-cookie': [
      `${BROWSER_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      LEGACY_BROWSER_SESSION_COOKIE_CLEAR,
    ],
  }
}

async function issueBrowserSessionCookie(input: {
  webId: string
  podUrl: string
  stellarPublicKey: string | null
  lockbox: {
    userLockboxContractId: string | null
    factoryContractId: string | null
    proofRootHex: string | null
  }
}): Promise<Record<string, string | string[]>> {
  if (!BROWSER_SESSION_ENABLED) return {}
  if (!BROWSER_SESSION_COOKIE_NAME.startsWith('__Host-')) {
    throw new Error('Browser session cookie name must use the __Host- prefix.')
  }
  if (!Number.isFinite(BROWSER_SESSION_TTL_MS) || BROWSER_SESSION_TTL_MS <= 0) {
    throw new Error('JSS_BROWSER_SESSION_TTL_MS must be positive.')
  }
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + BROWSER_SESSION_TTL_MS).toISOString()
  await credentialStore.saveBrowserSession(token, {
    webId: input.webId,
    podUrl: input.podUrl,
    stellarPublicKey: input.stellarPublicKey,
    userLockboxContractId: input.lockbox.userLockboxContractId,
    lockboxFactoryContractId: input.lockbox.factoryContractId,
    proofRootHex: input.lockbox.proofRootHex,
    expiresAt,
  })
  const maxAgeSeconds = Math.floor(BROWSER_SESSION_TTL_MS / 1000)
  return {
    'set-cookie': [
      `${BROWSER_SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`,
      LEGACY_BROWSER_SESSION_COOKIE_CLEAR,
    ],
  }
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

async function readBoundedJsonBody<T>(req: IncomingMessage, maxBytes: number): Promise<T> {
  const declaredLength = Number(req.headers['content-length'] ?? '0')
  if (declaredLength > maxBytes) throw new Error('Request body exceeds maximum size.')
  const chunks: Buffer[] = []
  let size = 0
  const timeoutMs = Number(process.env.JSS_REQUEST_BODY_TIMEOUT_MS ?? 5_000)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    req.destroy(new Error('Request body timed out.'))
  }, timeoutMs)
  try {
    for await (const chunk of req as AsyncIterable<Buffer | string>) {
      if (timedOut) throw new Error('Request body timed out.')
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > maxBytes) throw new Error('Request body exceeds maximum size.')
      chunks.push(buffer)
    }
  } finally {
    clearTimeout(timer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) throw new Error('Request body is required.')
  return JSON.parse(raw) as T
}

function verifyBearerSession(req: IncomingMessage): ReturnType<SessionTokenManager['verify']> {
  const authorization = req.headers.authorization ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  return match?.[1] ? sessions.verify(match[1]) : null
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeHex32(value: string, label: string): string {
  const normalized = value.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be 32 bytes of hex.`)
  }
  return normalized
}

function decimalFieldToHex32(value: string, label: string): string {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${label} must be a decimal field element.`)
  }
  const encoded = BigInt(value.trim()).toString(16)
  if (encoded.length > 64) {
    throw new Error(`${label} exceeds 32 bytes.`)
  }
  return encoded.padStart(64, '0')
}

function parseBridgeProof(
  body: {
    proofHex?: string
    proofHashHex?: string
    publicSignals?: string
    circuitVersion?: string
  },
  accountCommitmentHex: string,
  ciphertextHex: string
): BridgeProofPayload {
  if (
    !isNonEmpty(body.proofHex) ||
    !isNonEmpty(body.proofHashHex) ||
    !isNonEmpty(body.publicSignals)
  ) {
    throw new Error('Lockb0x Bridge Factory v3 requires proofHex, proofHashHex, and publicSignals.')
  }
  const proofHex = body.proofHex.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{512}$/.test(proofHex)) {
    throw new Error('proofHex must encode a 256-byte Groth16 proof.')
  }
  const proofHashHex = normalizeHex32(body.proofHashHex, 'proofHashHex')
  const ciphertext = ciphertextHex.trim().toLowerCase().replace(/^0x/, '')
  if (
    !/^[0-9a-f]+$/.test(ciphertext) ||
    ciphertext.length === 0 ||
    ciphertext.length % 2 !== 0 ||
    ciphertext.length > 8192
  ) {
    throw new Error('ciphertextHex must encode no more than 4096 encrypted bytes.')
  }
  const circuitVersion = Number(body.circuitVersion ?? '1')
  if (!Number.isInteger(circuitVersion) || circuitVersion <= 0) {
    throw new Error('circuitVersion must be a positive integer.')
  }

  let publicSignals: unknown
  try {
    publicSignals = JSON.parse(body.publicSignals)
  } catch {
    throw new Error('publicSignals must be JSON encoded.')
  }
  if (
    !Array.isArray(publicSignals) ||
    publicSignals.length !== 3 ||
    !publicSignals.every((item) => typeof item === 'string')
  ) {
    throw new Error('publicSignals must contain claimHash, accountCommitment, and podBinding.')
  }
  const claimHashHex = decimalFieldToHex32(publicSignals[0], 'claimHash')
  const signalAccountCommitmentHex = decimalFieldToHex32(publicSignals[1], 'accountCommitment')
  const podBindingHex = decimalFieldToHex32(publicSignals[2], 'podBinding')
  if (signalAccountCommitmentHex !== normalizeHex32(accountCommitmentHex, 'accountCommitmentHex')) {
    throw new Error('accountCommitmentHex does not match the bridge proof public signal.')
  }
  const computedProofHash = createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from(proofHex, 'hex'),
        Buffer.from(claimHashHex, 'hex'),
        Buffer.from(signalAccountCommitmentHex, 'hex'),
        Buffer.from(podBindingHex, 'hex'),
      ])
    )
    .digest('hex')
  if (computedProofHash !== proofHashHex) {
    throw new Error('proofHashHex does not match the serialized bridge proof and public signals.')
  }

  return {
    proofHex,
    proofHashHex,
    claimHashHex,
    accountCommitmentHex: signalAccountCommitmentHex,
    podBindingHex,
    ciphertextHex: ciphertext,
    circuitVersion,
  }
}

async function verifyCanonicalBridgeClaim(input: {
  bridgeProof: BridgeProofPayload
  webId: string
  podUrl: string
  stellarPublicKey: string
  factoryContractId: string
  configFingerprint: string
}): Promise<void> {
  const identityContractId = (
    process.env.JSS_IDENTITY_CONTRACT_ID ??
    process.env.NZ_IDENTITY_CONTRACT_ID ??
    ''
  ).trim()
  if (!identityContractId) {
    throw new Error(
      'JSS_IDENTITY_CONTRACT_ID is required for Factory V3 bridge claim verification.'
    )
  }
  const networkPassphrase = (
    process.env.JSS_STELLAR_NETWORK_PASSPHRASE ??
    process.env.NZ_STELLAR_NETWORK_PASSPHRASE ??
    'Test SDF Network ; September 2015'
  ).trim()
  const canonicalClaim = buildPodOwnershipClaim({
    circuitVersion: input.bridgeProof.circuitVersion,
    envProfile: process.env.NZ_ENV_PROFILE ?? 'local',
    stellarNetworkPassphrase: networkPassphrase,
    webId: input.webId,
    podUrl: input.podUrl,
    stellarPublicKey: input.stellarPublicKey,
    identityContractId,
    lockboxFactoryContractId: input.factoryContractId,
    challengeId: 'nz-seamless-v1',
    nonce: 'nz-seamless-v1',
    expiresAt: 'nz-seamless-v1',
    configFingerprint: input.configFingerprint,
  })
  const expectedClaimHash = (
    BigInt(`0x${createHash('sha256').update(canonicalClaim, 'utf8').digest('hex')}`) %
    BN254_SCALAR_FIELD_SIZE
  )
    .toString(16)
    .padStart(64, '0')
  if (expectedClaimHash !== input.bridgeProof.claimHashHex) {
    throw new Error(
      'Bridge proof claimHash does not match the provisioned Pod, Stellar identity, and Factory V3 binding.'
    )
  }
  await verifyBridgeProof({
    proofHex: input.bridgeProof.proofHex,
    publicSignals: [
      BigInt(`0x${input.bridgeProof.claimHashHex}`).toString(),
      BigInt(`0x${input.bridgeProof.accountCommitmentHex}`).toString(),
      BigInt(`0x${input.bridgeProof.podBindingHex}`).toString(),
    ],
    verificationKeyUrl: LOCKBOX_BRIDGE_V3_VK_URL,
    verificationKeySha256: LOCKBOX_BRIDGE_V3_VK_SHA256,
  })
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
    throw new DocustreamRssFetchError(
      'Feed URL credentials are not allowed.',
      400,
      'invalid_credentials'
    )
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
    throw new DocustreamRssFetchError(
      'Feed host resolves to a blocked address.',
      400,
      'blocked_host'
    )
  }

  return parsed
}

function ensureAllowedContentType(contentTypeHeader: string | null): void {
  const normalized = (contentTypeHeader ?? '').toLowerCase().split(';')[0].trim()
  if (!normalized || !DOCUSTREAM_ALLOWED_CONTENT_TYPES.includes(normalized)) {
    throw new DocustreamRssFetchError(
      'Feed content type is not supported.',
      415,
      'unsupported_content_type'
    )
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
          accept:
            'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
        },
        redirect: 'manual',
        signal: controller.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          throw new DocustreamRssFetchError(
            'Feed redirect location is missing.',
            502,
            'redirect_missing_location'
          )
        }
        if (redirect === DOCUSTREAM_RSS_MAX_REDIRECTS) {
          throw new DocustreamRssFetchError(
            'Feed has too many redirects.',
            502,
            'too_many_redirects'
          )
        }
        currentUrl = await validateDocustreamRssUrl(new URL(location, currentUrl).toString())
        continue
      }

      if (!response.ok) {
        throw new DocustreamRssFetchError(
          `Feed responded with HTTP ${response.status}.`,
          502,
          'upstream_http_error'
        )
      }

      ensureAllowedContentType(response.headers.get('content-type'))

      const declaredLength = Number(response.headers.get('content-length') ?? '0')
      if (declaredLength > DOCUSTREAM_RSS_MAX_BYTES) {
        throw new DocustreamRssFetchError(
          'Feed payload exceeds maximum size.',
          413,
          'payload_too_large'
        )
      }

      const xml = await response.text()
      const xmlBytes = Buffer.byteLength(xml, 'utf8')
      if (xmlBytes > DOCUSTREAM_RSS_MAX_BYTES) {
        throw new DocustreamRssFetchError(
          'Feed payload exceeds maximum size.',
          413,
          'payload_too_large'
        )
      }
      if (!xml.trim()) {
        throw new DocustreamRssFetchError('Feed payload is empty.', 502, 'empty_payload')
      }

      return xml
    }

    throw new DocustreamRssFetchError(
      'Feed retrieval exceeded redirect limit.',
      502,
      'too_many_redirects'
    )
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
  const value = Array.isArray(provided) ? (provided[0] ?? '') : (provided ?? '')
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
  if (!isNonEmpty(body.lockboxFactoryContractId))
    throw new Error('lockboxFactoryContractId is required.')
  if (!isNonEmpty(body.challengeId)) throw new Error('challengeId is required.')
  if (!isNonEmpty(body.signatureBase64)) throw new Error('signatureBase64 is required.')
  if (body.proofVersion !== 1) throw new Error('proofVersion=1 is required.')
  if (!isNonEmpty(body.claimHash)) throw new Error('claimHash is required.')
  if (!isNonEmpty(body.proofHex)) throw new Error('proofHex is required.')
  if (!isNonEmpty(body.proofHashHex)) throw new Error('proofHashHex is required.')
  if (!isNonEmpty(body.proofRootHex)) throw new Error('proofRootHex is required.')
  if (!Array.isArray(body.publicSignals)) throw new Error('publicSignals is required.')
}

/**
 * Fail-closed session issuance: mints a live Solid token from stored client
 * credentials and probes the Pod BEFORE any NodeZero session is created.
 * Throws when the invariant cannot be proven.
 */
async function issueVerifiedSession(input: {
  webId: string
  podUrl: string
  stellarPublicKey?: string | null
  credentials: { id: string; secret: string }
}): Promise<ReturnType<SessionTokenManager['issue']>> {
  const token = await mintPodAccessToken(SOLID_CSS_BASE_URL, input.credentials)
  await probePodAccess(token, input.podUrl)
  return sessions.issue({
    webId: input.webId,
    podUrl: input.podUrl,
    stellarPublicKey: input.stellarPublicKey ?? null,
  })
}

export async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  overrides: RequestHandlerOverrides = {}
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req))
    res.end()
    return
  }

  // Pod Access Proxy: the only runtime path between clients and CSS.
  if (url.pathname.startsWith(POD_PROXY_PREFIX)) {
    await handlePodProxyRequest(req, res, {
      cssBaseUrl: SOLID_CSS_BASE_URL,
      credentialStore,
      sessions,
      corsHeaders,
      ...(overrides.readPodProxyPublicationConsent
        ? { readPublicationConsent: overrides.readPodProxyPublicationConsent }
        : {}),
      getSuppressionRevision:
        overrides.getPodProxySuppressionRevision ??
        (async (webId): Promise<number | null> => {
          await communityDirectory.reloadRecord(webId)
          const record = communityDirectory.getDurableByWebId(webId)
          return record?.suppressedAt ? (record.suppressionRevision ?? null) : null
        }),
      auditLog: (event, detail) => {
        console.log(`[pod-proxy:audit] ${event}`, JSON.stringify(detail))
      },
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    let communityDirectoryReady = false
    try {
      await communityDirectory.probe()
      communityDirectoryReady = true
    } catch {
      communityDirectoryReady = false
    }
    const sessionReady =
      (process.env.NZ_ENV_PROFILE ?? 'local') === 'local' || !sessions.usesEphemeralKey
    const healthReady = communityDirectoryReady && TRANSPORT_IDENTITY_READY && sessionReady
    sendJson(req, res, healthReady ? 200 : 503, {
      ok: healthReady,
      service: 'jss-provisioner',
      build: {
        commit: EMBEDDED_BUILD.commit,
        payloadSha256: EMBEDDED_BUILD.payloadSha256,
        configuredArtifactSha256: CONFIGURED_ARTIFACT_SHA256,
      },
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
      session: {
        signingKeyConfigured: !sessions.usesEphemeralKey,
        credentialBackend: credentialStore.backendKind,
        credentialKeyConfigured: !credentialStore.usesEphemeralKey,
      },
      relationshipDelivery: {
        assertionKeyConfigured: !relationshipDeliveryAssertions.usesEphemeralKey,
        ready: RELATIONSHIP_ASSERTIONS_READY,
      },
      transportIdentity: {
        assertionKeyConfigured: !transportIdentityAssertions.usesEphemeralKey,
        ready: TRANSPORT_IDENTITY_READY,
      },
      communityDirectory: {
        backend: COMMUNITY_DIRECTORY_TABLE_SAS_URL ? 'table' : 'file',
        ready: communityDirectoryReady,
      },
      milestoneQ: {
        flags: milestoneQControls.flags(),
      },
      browserSession: {
        enabled: BROWSER_SESSION_ENABLED,
        cookieScope: BROWSER_SESSION_ENABLED ? 'host-only' : null,
      },
      treasuryCreateAccount: {
        onboardingEnabled: TREASURY_FUND_MEMBERS,
        internalApiEnabled: Boolean(INTERNAL_API_KEY),
      },
      notificationEvents: {
        mode: notificationPublisher.mode,
        webhookConfigured: Boolean((process.env.JSS_NOTIFICATION_WEBHOOK_URL ?? '').trim()),
      },
      uptimeMs: Math.round(process.uptime() * 1000),
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/v1/onboarding/config') {
    const descriptor = buildOnboardingConfigDescriptor()
    sendJson(req, res, 200, descriptor, {
      'cache-control': 'public, max-age=60, must-revalidate',
      etag: `"${descriptor.configFingerprint}"`,
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
      sendJson(req, res, 503, {
        error: 'Solid account provisioning is not configured (JSS_SOLID_CSS_BASE_URL).',
      })
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
      exists:
        knownSolidAccountEmails.has(email) || (await provisioningStore.isEmailReserved(email)),
      source: 'provisioner-reservations',
      checkedAt: new Date().toISOString(),
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/v1/milestone-q/features') {
    const claims = verifyBearerSession(req)
    if (!claims) {
      sendJson(req, res, 401, {
        error: 'A valid NodeZero session is required.',
        code: 'session_invalid',
      })
      return
    }
    sendJson(
      req,
      res,
      200,
      {
        version: 1,
        features: milestoneQControls.availability(claims.sub),
      },
      { 'cache-control': 'private, no-store' }
    )
    return
  }

  if (req.method === 'GET' && url.pathname === '/v1/community-directory/index') {
    const claims = verifyBearerSession(req)
    if (!claims || !milestoneQControls.isEnabled('directory', claims.sub)) {
      milestoneQControls.count('directory', claims ? 'cohort-denied' : 'unauthorized')
      sendJson(req, res, 404, { error: 'Not found' })
      return
    }
    const indexLimit = communityDirectoryIndexRateLimiter.consume(claims.sub)
    if (!indexLimit.allowed) {
      sendJson(
        req,
        res,
        429,
        {
          error: 'Community directory index rate limit exceeded.',
          code: 'directory_index_rate_limited',
        },
        {
          'retry-after': String(indexLimit.retryAfterSeconds),
          'cache-control': 'private, no-store',
        }
      )
      return
    }
    try {
      await (
        overrides.reloadCommunityDirectory ??
        ((): Promise<void> => communityDirectory.reload())
      )()
    } catch {
      sendJson(
        req,
        res,
        503,
        {
          error: 'Community directory index is temporarily unavailable.',
          code: 'directory_index_unavailable',
        },
        { 'cache-control': 'private, no-store' }
      )
      return
    }
    const rawLimit = Number(url.searchParams.get('limit') ?? '100')
    const limit = Number.isInteger(rawLimit) ? rawLimit : 100
    const page = communityDirectory.buildPublicPage({
      ...(url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor')! } : {}),
      limit,
      include: (record) => milestoneQControls.isEnabled('directory', record.webId),
    })
    if (ifNoneMatchMatches(req.headers['if-none-match'], page.etag)) {
      res.writeHead(304, {
        ...corsHeaders(req),
        etag: page.etag,
        'cache-control': 'private, no-cache, must-revalidate',
      })
      res.end()
      return
    }
    sendJson(req, res, 200, page, {
      etag: page.etag,
      'cache-control': 'private, no-cache, must-revalidate',
    })
    milestoneQControls.count('directory', 'page-served')
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/community-directory/refresh') {
    const claims = verifyBearerSession(req)
    if (!claims) {
      sendJson(req, res, 401, {
        error: 'A valid NodeZero session is required.',
        code: 'session_invalid',
      })
      return
    }
    const directoryAvailable = milestoneQControls.isEnabled('directory', claims.sub)
    if (!directoryAvailable) milestoneQControls.count('directory', 'cohort-denied')
    const refreshLimit = communityDirectoryRefreshRateLimiter.consume(claims.sub)
    if (!refreshLimit.allowed) {
      sendJson(
        req,
        res,
        429,
        {
          error: 'Community directory refresh rate limit exceeded.',
          code: 'directory_refresh_rate_limited',
        },
        { 'retry-after': String(refreshLimit.retryAfterSeconds) }
      )
      return
    }
    if (communityDirectoryRefreshActiveRequests >= COMMUNITY_DIRECTORY_REFRESH_MAX_CONCURRENCY) {
      sendJson(
        req,
        res,
        429,
        {
          error: 'Community directory refresh capacity reached.',
          code: 'directory_refresh_concurrency_limited',
        },
        { 'retry-after': '1' }
      )
      return
    }
    communityDirectoryRefreshActiveRequests += 1
    try {
      const refresh =
        overrides.refreshCommunityDirectoryProjection ?? refreshCommunityDirectoryProjection
      const record = await refresh(claims, {
        credentialStore,
        directoryStore: communityDirectory,
        cssBaseUrl: SOLID_CSS_BASE_URL,
        allowListing: directoryAvailable,
      })
      sendJson(req, res, 200, {
        status: 'ok',
        listed: record.listed,
        available: directoryAvailable,
      })
      milestoneQControls.count('directory', record.listed ? 'listed' : 'unlisted')
    } catch (error) {
      if (error instanceof CommunityDirectoryRefreshError) {
        const status = error.code === 'session_invalid' ? 401 : 403
        sendJson(req, res, status, { error: error.message, code: error.code })
        return
      }
      sendJson(req, res, 503, {
        error: 'Community directory refresh is temporarily unavailable.',
        code: 'directory_refresh_unavailable',
      })
      milestoneQControls.count('directory', 'refresh-failed')
    } finally {
      communityDirectoryRefreshActiveRequests -= 1
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/community-directory/suppress') {
    const claims = verifyBearerSession(req)
    if (!claims) {
      sendJson(req, res, 401, {
        error: 'A valid NodeZero session is required.',
        code: 'session_invalid',
      })
      return
    }
    const publicationRevision = req.headers['x-nodezero-publication-revision']
    if (
      typeof publicationRevision !== 'string' ||
      !/^\d+$/.test(publicationRevision) ||
      !Number.isSafeInteger(Number(publicationRevision))
    ) {
      sendJson(req, res, 428, {
        error: 'Directory suppression requires the observed publication generation.',
        code: 'publication_precondition_required',
      })
      return
    }
    const suppressLimit = communityDirectorySuppressRateLimiter.consume(claims.sub)
    if (!suppressLimit.allowed) {
      sendJson(
        req,
        res,
        429,
        {
          error: 'Community directory suppression rate limit exceeded.',
          code: 'directory_suppress_rate_limited',
        },
        { 'retry-after': String(suppressLimit.retryAfterSeconds) }
      )
      return
    }
    try {
      const refresh =
        overrides.refreshCommunityDirectoryProjection ?? refreshCommunityDirectoryProjection
      await refresh(claims, {
        credentialStore,
        directoryStore: communityDirectory,
        cssBaseUrl: SOLID_CSS_BASE_URL,
        allowListing: false,
        expectedPublicationRevision: Number(publicationRevision),
      })
      sendJson(req, res, 200, { status: 'ok', listed: false })
      milestoneQControls.count('directory', 'suppressed')
    } catch (error) {
      if (error instanceof CommunityDirectoryRefreshError && error.code === 'session_invalid') {
        sendJson(req, res, 401, { error: error.message, code: error.code })
      } else if (
        error instanceof CommunityDirectoryRefreshError &&
        error.code === 'publication_changed'
      ) {
        sendJson(req, res, 409, { error: error.message, code: error.code })
      } else {
        sendJson(req, res, 503, {
          error: 'Community directory suppression is temporarily unavailable.',
          code: 'directory_suppress_unavailable',
        })
      }
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/community-directory/avatar') {
    const claims = verifyBearerSession(req)
    if (!claims) {
      sendJson(req, res, 401, {
        error: 'A valid NodeZero session is required.',
        code: 'session_invalid',
      })
      return
    }
    if (!milestoneQControls.isEnabled('directory', claims.sub)) {
      sendJson(req, res, 404, { error: 'Not found' })
      return
    }
    const avatarLimit = communityDirectoryAvatarRateLimiter.consume(claims.sub)
    if (!avatarLimit.allowed) {
      sendJson(
        req,
        res,
        429,
        { error: 'Directory avatar rate limit exceeded.', code: 'avatar_rate_limited' },
        { 'retry-after': String(avatarLimit.retryAfterSeconds) }
      )
      return
    }
    if (communityDirectoryAvatarActiveRequests >= COMMUNITY_DIRECTORY_AVATAR_MAX_CONCURRENCY) {
      sendJson(
        req,
        res,
        429,
        { error: 'Directory avatar capacity reached.', code: 'avatar_concurrency_limited' },
        { 'retry-after': '1' }
      )
      return
    }
    communityDirectoryAvatarActiveRequests += 1
    try {
      const body = await readBoundedJsonBody<{ webId?: unknown }>(req, 4 * 1024)
      const webId = typeof body.webId === 'string' ? body.webId : ''
      const record = overrides.readDirectoryRecord
        ? await overrides.readDirectoryRecord(webId)
        : await communityDirectory
            .reload()
            .then(() => communityDirectory.getCommittedByWebId(webId))
      const expiresAt = record?.manifestExpiresAt
        ? Date.parse(record.manifestExpiresAt)
        : Number.NaN
      if (
        !record?.listed ||
        !milestoneQControls.isEnabled('directory', record.webId) ||
        !record.avatarUrl ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now()
      ) {
        sendJson(req, res, 404, { error: 'Directory avatar not found.', code: 'avatar_not_found' })
        return
      }
      const avatar = await (overrides.fetchDirectoryAvatar ?? fetchPublicResource)(
        record.avatarUrl,
        {
          maxBytes: 512 * 1024,
          allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        }
      )
      res.writeHead(200, {
        ...corsHeaders(req),
        'content-type': avatar.contentType,
        'content-length': String(avatar.body.length),
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      })
      res.end(avatar.body)
    } catch (error) {
      if (error instanceof PublicResourceFetchError) {
        sendJson(req, res, error.statusCode, { error: error.message, code: error.code })
        return
      }
      sendJson(req, res, 502, {
        error: 'Directory avatar is unavailable.',
        code: 'avatar_unavailable',
      })
    } finally {
      communityDirectoryAvatarActiveRequests -= 1
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/public-profile/read') {
    const claims = verifyBearerSession(req)
    if (!claims) {
      sendJson(req, res, 401, {
        error: 'A valid NodeZero session is required.',
        code: 'session_invalid',
      })
      return
    }
    if (!milestoneQControls.isEnabled('peer-profile', claims.sub)) {
      milestoneQControls.count('peer-profile', 'cohort-denied')
      sendJson(req, res, 404, { error: 'Not found' })
      return
    }
    const profileReadLimit = publicProfileReadRateLimiter.consume(claims.sub)
    if (!profileReadLimit.allowed) {
      sendJson(
        req,
        res,
        429,
        {
          error: 'Public profile read rate limit exceeded.',
          code: 'public_profile_rate_limited',
        },
        { 'retry-after': String(profileReadLimit.retryAfterSeconds) }
      )
      return
    }
    const activeRequests = publicProfileActiveRequests.get(claims.sub) ?? 0
    if (activeRequests >= PUBLIC_PROFILE_MAX_CONCURRENCY) {
      sendJson(
        req,
        res,
        429,
        {
          error: 'Too many concurrent public profile reads.',
          code: 'public_profile_concurrency_limited',
        },
        { 'retry-after': '1' }
      )
      return
    }
    publicProfileActiveRequests.set(claims.sub, activeRequests + 1)
    try {
      const body = await readBoundedJsonBody<{ webId?: string }>(req, 4 * 1024)
      if (!isNonEmpty(body.webId)) {
        sendJson(req, res, 400, { error: 'webId is required.', code: 'invalid_webid' })
        return
      }
      const readProfile = overrides.readPublicPeerProfile ?? readPublicPeerProfile
      const result = await readProfile(body.webId)
      if (!result.profile) {
        sendJson(req, res, 404, { error: 'Public profile not found.', code: 'profile_not_found' })
        return
      }
      sendJson(req, res, 200, result, { 'cache-control': 'private, no-store' })
      milestoneQControls.count('peer-profile', 'read')
    } catch (error) {
      if (error instanceof PublicPeerProfileError && error.code === 'invalid_webid') {
        sendJson(req, res, 400, { error: error.message, code: error.code })
        return
      }
      sendJson(req, res, 503, {
        error: 'Public profile is temporarily unavailable.',
        code: 'public_profile_unavailable',
      })
      milestoneQControls.count('peer-profile', 'read-failed')
    } finally {
      const remaining = (publicProfileActiveRequests.get(claims.sub) ?? 1) - 1
      if (remaining <= 0) publicProfileActiveRequests.delete(claims.sub)
      else publicProfileActiveRequests.set(claims.sub, remaining)
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/transport-identity/assertion') {
    if (!TRANSPORT_IDENTITY_READY) {
      sendJson(req, res, 503, {
        error: 'Transport identity assertions are not configured.',
        code: 'transport_identity_unavailable',
      })
      return
    }
    const claims = verifyBearerSession(req)
    if (!claims) {
      sendJson(req, res, 401, {
        error: 'A valid NodeZero session is required.',
        code: 'session_invalid',
      })
      return
    }
    if (!milestoneQControls.isEnabled('transport', claims.sub)) {
      milestoneQControls.count('transport', 'cohort-denied')
      sendJson(req, res, 404, { error: 'Not found' })
      return
    }
    const body = await readBoundedJsonBody<{ audience?: unknown; subject?: unknown }>(req, 1024)
    if (!isTransportIdentityAudience(body.audience)) {
      sendJson(req, res, 400, {
        error: 'audience must be waku or relay.',
        code: 'invalid_audience',
      })
      return
    }
    try {
      sendJson(
        req,
        res,
        200,
        {
          assertion: transportIdentityAssertions.issue(
            claims,
            body.audience,
            new Date(),
            typeof body.subject === 'string' ? body.subject : claims.sub
          ),
          webId: claims.sub,
          stellarPublicKey: claims.spk,
          audience: body.audience,
        },
        { 'cache-control': 'private, no-store' }
      )
      milestoneQControls.count('transport', 'assertion-issued')
    } catch {
      sendJson(req, res, 403, {
        error: 'The session is not bound to a Stellar identity key.',
        code: 'identity_key_unavailable',
      })
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/transport-identity/verify') {
    if (!TRANSPORT_IDENTITY_READY) {
      sendJson(req, res, 503, {
        error: 'Transport identity assertions are not configured.',
        code: 'transport_identity_unavailable',
      })
      return
    }
    if (!milestoneQControls.isConfigured('transport')) {
      milestoneQControls.count('transport', 'disabled')
      sendJson(req, res, 404, { error: 'Not found' })
      return
    }
    const verificationKey = req.socket.remoteAddress ?? 'unknown'
    const verificationLimit = transportVerificationRateLimiter.consume(verificationKey)
    if (!verificationLimit.allowed) {
      sendJson(
        req,
        res,
        429,
        {
          error: 'Transport identity verification rate limit exceeded.',
          code: 'transport_identity_rate_limited',
        },
        { 'retry-after': String(verificationLimit.retryAfterSeconds) }
      )
      return
    }
    if (transportVerificationActiveRequests >= TRANSPORT_VERIFY_MAX_CONCURRENCY) {
      sendJson(
        req,
        res,
        429,
        {
          error: 'Transport identity verification capacity reached.',
          code: 'transport_identity_concurrency_limited',
        },
        { 'retry-after': '1' }
      )
      return
    }
    transportVerificationActiveRequests += 1
    try {
      const body = await readBoundedJsonBody<{
        assertion?: unknown
        audience?: unknown
      }>(req, 8 * 1024)
      if (typeof body.assertion !== 'string' || !isTransportIdentityAudience(body.audience)) {
        sendJson(req, res, 400, {
          error: 'A valid assertion and audience are required.',
          code: 'invalid_assertion',
        })
        return
      }
      const identity = transportIdentityAssertions.readVerified(body.assertion, body.audience)
      if (!identity || !milestoneQControls.isEnabled('transport', identity.accountWebId)) {
        sendJson(req, res, 401, {
          error: 'Transport identity assertion is invalid.',
          code: 'invalid_assertion',
        })
        return
      }
      const { accountWebId: _accountWebId, ...publicIdentity } = identity
      void _accountWebId
      sendJson(req, res, 200, publicIdentity, { 'cache-control': 'no-store' })
      milestoneQControls.count('transport', 'verified')
    } finally {
      transportVerificationActiveRequests -= 1
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/social/relationship-delivery') {
    if (!RELATIONSHIP_ASSERTIONS_READY) {
      sendJson(req, res, 503, {
        error: 'Relationship delivery assertions are not configured.',
        code: 'relationship_delivery_unavailable',
      })
      return
    }
    const claims = verifyBearerSession(req)
    if (!claims) {
      sendJson(req, res, 401, {
        error: 'A valid NodeZero session is required.',
        code: 'session_invalid',
      })
      return
    }
    if (!milestoneQControls.isEnabled('relationship', claims.sub)) {
      milestoneQControls.count('relationship', 'cohort-denied')
      sendJson(req, res, 404, { error: 'Not found' })
      return
    }
    const deliveryLimit = relationshipDeliveryRateLimiter.consume(claims.sub)
    if (!deliveryLimit.allowed) {
      sendJson(
        req,
        res,
        429,
        {
          error: 'Relationship delivery rate limit exceeded.',
          code: 'relationship_delivery_rate_limited',
        },
        { 'retry-after': String(deliveryLimit.retryAfterSeconds) }
      )
      return
    }

    try {
      const body = await readBoundedJsonBody<{
        recipientWebId?: string
        activity?: unknown
      }>(req, 64 * 1024)
      if (!isNonEmpty(body.recipientWebId) || body.activity === undefined) {
        sendJson(req, res, 400, {
          error: 'recipientWebId and activity are required.',
          code: 'invalid_request',
        })
        return
      }
      const result = await deliverRelationshipActivity(
        claims,
        {
          recipientWebId: body.recipientWebId,
          activity: body.activity,
        },
        {
          assertionManager: relationshipDeliveryAssertions,
          isRecipientBlocked: (sessionClaims, recipientWebId) =>
            (overrides.isRelationshipRecipientBlocked ?? isRelationshipRecipientBlocked)(
              sessionClaims,
              recipientWebId,
              { cssBaseUrl: SOLID_CSS_BASE_URL, credentialStore }
            ),
        }
      )
      sendJson(req, res, 200, result)
    } catch (error) {
      if (error instanceof RelationshipDeliveryError) {
        sendJson(req, res, error.statusCode, { error: error.message, code: error.code })
        return
      }
      if (error instanceof SyntaxError) {
        sendJson(req, res, 400, { error: 'Request body must be valid JSON.', code: 'invalid_json' })
        return
      }
      const message = error instanceof Error ? error.message : 'Relationship delivery failed.'
      const statusCode = message.includes('maximum size') ? 413 : 400
      sendJson(req, res, statusCode, { error: message, code: 'invalid_request' })
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/social/relationship-delivery/verify') {
    if (!RELATIONSHIP_ASSERTIONS_READY) {
      sendJson(req, res, 503, {
        error: 'Relationship delivery assertions are not configured.',
        code: 'relationship_delivery_unavailable',
      })
      return
    }
    const claims = verifyBearerSession(req)
    if (!claims) {
      sendJson(req, res, 401, {
        error: 'A valid NodeZero session is required.',
        code: 'session_invalid',
      })
      return
    }
    if (!milestoneQControls.isEnabled('relationship', claims.sub)) {
      milestoneQControls.count('relationship', 'cohort-denied')
      sendJson(req, res, 404, { error: 'Not found' })
      return
    }
    const verificationLimit = relationshipVerificationRateLimiter.consume(claims.sub)
    if (!verificationLimit.allowed) {
      sendJson(
        req,
        res,
        429,
        {
          error: 'Relationship verification rate limit exceeded.',
          code: 'relationship_verification_rate_limited',
        },
        { 'retry-after': String(verificationLimit.retryAfterSeconds) }
      )
      return
    }
    try {
      const body = await readBoundedJsonBody<{ activity?: unknown }>(req, 64 * 1024)
      if (body.activity === undefined) {
        sendJson(req, res, 400, { error: 'activity is required.', code: 'invalid_request' })
        return
      }
      const assertion = readRelationshipDeliveryAssertion(body.activity)
      const actorWebId = assertion
        ? relationshipDeliveryAssertions.verify(assertion, body.activity, claims.sub)
        : null
      if (!actorWebId) {
        sendJson(req, res, 422, {
          error: 'Relationship delivery assertion is missing or invalid.',
          code: 'sender_unverified',
        })
        return
      }
      sendJson(req, res, 200, { actorWebId })
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(req, res, 400, { error: 'Request body must be valid JSON.', code: 'invalid_json' })
        return
      }
      const message = error instanceof Error ? error.message : 'Assertion verification failed.'
      const statusCode = message.includes('maximum size') ? 413 : 400
      sendJson(req, res, statusCode, { error: message, code: 'invalid_request' })
    }
    return
  }

  if (
    req.method === 'POST' &&
    (url.pathname === '/v1/community-directory/opt-in' ||
      url.pathname === '/v1/community-directory/opt-out')
  ) {
    sendJson(req, res, 410, {
      error: 'Legacy directory mutation is retired. Use the authenticated refresh endpoint.',
      code: 'directory_mutation_retired',
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
      sendJson(req, res, 503, {
        error: 'Solid account provisioning is not configured (JSS_SOLID_CSS_BASE_URL).',
      })
      return
    }

    const body = await readJsonBody<{
      name?: string
      email?: string
      stellarPublicKey?: string
      accountCommitmentHex?: string
      ciphertextHex?: string
      proofHex?: string
      proofHashHex?: string
      publicSignals?: string
      circuitVersion?: string
      configFingerprint?: string
    }>(req)
    if (!isNonEmpty(body.name)) {
      sendJson(req, res, 400, { error: 'name is required.' })
      return
    }
    if (!isNonEmpty(body.email)) {
      sendJson(req, res, 400, { error: 'email is required.' })
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
      sendJson(req, res, 400, {
        error: 'stellarPublicKey must be a valid Stellar public key (G...).',
      })
      return
    }

    const normalizedName = body.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
    if (!normalizedName) {
      sendJson(req, res, 400, { error: 'name must contain alphanumeric characters.' })
      return
    }

    const activeConfig = buildOnboardingConfigDescriptor()
    const suppliedFingerprint = isNonEmpty(body.configFingerprint)
      ? body.configFingerprint.trim().toLowerCase()
      : null
    if (
      (suppliedFingerprint !== null && suppliedFingerprint !== activeConfig.configFingerprint) ||
      (LOCKBOX_FACTORY_VERSION === 'v3' && (suppliedFingerprint === null || !activeConfig.ready))
    ) {
      sendJson(req, res, 409, {
        error: 'The onboarding configuration changed. Refresh the app before creating a node.',
        code: 'config_stale',
        configFingerprint: activeConfig.configFingerprint,
      })
      return
    }

    let sagaOperation: VersionedProvisioningOperation | null = null
    let sagaLease: ProvisioningLease | null = null
    try {
      const email = normalizeEmail(body.email)
      let treasuryFunded = false
      if (!isValidEmail(email)) {
        sendJson(req, res, 400, { error: 'email must be a valid email address.' })
        return
      }

      // Validate every deterministic V3 proof input before creating anything
      // in CSS. The provisioned Pod/WebID paths are derived from the same
      // normalized handle, so a stale or malformed proof cannot orphan a Pod.
      const accountCommitmentHex =
        typeof body.accountCommitmentHex === 'string' ? body.accountCommitmentHex.trim() : ''
      const ciphertextHex = typeof body.ciphertextHex === 'string' ? body.ciphertextHex.trim() : ''
      const bridgeProof =
        LOCKBOX_FACTORY_VERSION === 'v3'
          ? parseBridgeProof(body, accountCommitmentHex, ciphertextHex)
          : undefined
      const expectedPodUrl = `${SOLID_CSS_BASE_URL}/${normalizedName}/`
      const expectedWebId = `${expectedPodUrl}profile/card#me`
      const requestDigest = computeProvisioningRequestDigest({
        normalizedName,
        email,
        stellarPublicKey,
        accountCommitmentHex,
        ciphertextHex,
        proofHex: bridgeProof?.proofHex ?? '',
        proofHashHex: bridgeProof?.proofHashHex ?? '',
        claimHashHex: bridgeProof?.claimHashHex ?? '',
        podBindingHex: bridgeProof?.podBindingHex ?? '',
        circuitVersion: bridgeProof?.circuitVersion ?? '',
        configFingerprint: activeConfig.configFingerprint,
      })
      const headerIdempotencyKey = Array.isArray(req.headers['idempotency-key'])
        ? req.headers['idempotency-key'][0]
        : req.headers['idempotency-key']
      const idempotencyKey = headerIdempotencyKey?.trim() || `legacy:${requestDigest}`
      if (idempotencyKey.length > 256) {
        sendJson(req, res, 400, { error: 'Idempotency-Key must not exceed 256 characters.' })
        return
      }

      sagaOperation = await provisioningStore.reserveOrLoad({
        idempotencyKey,
        requestDigest,
        normalizedHandle: normalizedName,
        normalizedEmail: email,
        expectedWebId,
        expectedPodUrl,
        stellarPublicKey,
        configFingerprint: activeConfig.configFingerprint,
        descriptorSnapshot: activeConfig,
        resumeMaterial: {
          password: generateEphemeralCssPassword(),
        } satisfies SolidAccountResumeMaterial,
      })
      if (sagaOperation.operation.state === 'manual_review') {
        sendJson(req, res, 409, {
          error: 'Provisioning requires operator review before it can continue.',
          code: 'provisioning_manual_review',
          operationId: sagaOperation.operation.operationId,
        })
        return
      }
      if (sagaOperation.operation.state === 'failed_terminal') {
        sendJson(req, res, 409, {
          error: 'Provisioning cannot continue because the original request failed validation.',
          code: 'provisioning_failed_terminal',
          operationId: sagaOperation.operation.operationId,
        })
        return
      }
      const acquired = await provisioningStore.acquireLease(
        sagaOperation,
        `http-${process.pid}-${randomBytes(8).toString('hex')}`,
        PROVISIONING_LEASE_TTL_MS
      )
      sagaOperation = acquired.operation
      sagaLease = acquired.lease
      const replayingCompletedOperation = sagaOperation.operation.state === 'completed'

      if (sagaOperation.operation.state === 'reserved') {
        try {
          if (bridgeProof) {
            await verifyCanonicalBridgeClaim({
              bridgeProof,
              webId: expectedWebId,
              podUrl: expectedPodUrl,
              stellarPublicKey,
              factoryContractId: LOCKBOX_FACTORY_CONTRACT_ID,
              configFingerprint: activeConfig.configFingerprint,
            })
          }
          sagaOperation = await provisioningStore.transition(
            sagaOperation,
            sagaLease,
            'proof_verified'
          )
        } catch (proofError) {
          const terminalOperation = await provisioningStore
            .transition(sagaOperation, sagaLease, 'failed_terminal', {
              errorCode: 'proof_verification_failed',
            })
            .catch(() => null)
          if (terminalOperation) {
            sagaOperation = terminalOperation
            const releasedOperation = await provisioningStore
              .releaseLease(terminalOperation, sagaLease)
              .catch(() => null)
            if (releasedOperation) sagaOperation = releasedOperation
          }
          throw proofError
        }
      }

      let resumeMaterial = provisioningStore.decryptResumeMaterial<SolidAccountResumeMaterial>(
        sagaOperation.operation
      )
      if (sagaOperation.operation.state === 'proof_verified') {
        sagaOperation = await provisioningStore.transition(
          sagaOperation,
          sagaLease,
          'css_account_pending'
        )
      }

      if (sagaOperation.operation.state === 'css_account_pending') {
        try {
          const renewed = await provisioningStore.renewLease(
            sagaOperation,
            sagaLease,
            PROVISIONING_LEASE_TTL_MS
          )
          sagaOperation = renewed.operation
          sagaLease = renewed.lease
          if (!resumeMaterial.password) {
            throw new Error('Provisioning checkpoint is missing the temporary CSS password.')
          }
          const createdAccount = await createSolidAccount(SOLID_CSS_BASE_URL, {
            name: normalizedName,
            email,
            password: resumeMaterial.password,
          })
          resumeMaterial = { ...resumeMaterial, account: createdAccount }
          sagaOperation = await provisioningStore.transition(
            sagaOperation,
            sagaLease,
            'css_account_created',
            { resumeMaterial }
          )
        } catch (cssError) {
          sagaOperation = await provisioningStore
            .markManualReview(sagaOperation, 'css_account_result_unknown')
            .catch(() => sagaOperation)
          throw cssError
        }
      }
      for (const nextState of [
        'css_login_created',
        'pod_created',
        'client_credentials_created',
      ] as const) {
        const currentState = sagaOperation.operation.state
        const eligible =
          (nextState === 'css_login_created' && currentState === 'css_account_created') ||
          (nextState === 'pod_created' && currentState === 'css_login_created') ||
          (nextState === 'client_credentials_created' && currentState === 'pod_created')
        if (eligible) {
          sagaOperation = await provisioningStore.transition(sagaOperation, sagaLease, nextState)
        }
      }
      resumeMaterial = provisioningStore.decryptResumeMaterial<SolidAccountResumeMaterial>(
        sagaOperation.operation
      )
      if (!resumeMaterial.account) {
        throw new Error('Provisioning checkpoint is missing the CSS account result.')
      }
      let account = resumeMaterial.account
      if (!('clientCredentialsId' in account) || !('clientCredentialsSecret' in account)) {
        const storedCredentials = await credentialStore.findByWebId(expectedWebId)
        if (!storedCredentials) {
          throw new Error('Completed provisioning credentials are unavailable.')
        }
        account = {
          webId: storedCredentials.webId,
          podUrl: storedCredentials.podUrl,
          clientCredentialsId: storedCredentials.clientCredentialsId,
          clientCredentialsSecret: storedCredentials.clientCredentialsSecret,
          clientCredentialsResource: '',
        }
      }
      if (account.webId !== expectedWebId || account.podUrl !== expectedPodUrl) {
        sagaOperation = await provisioningStore.markManualReview(
          sagaOperation,
          'css_account_identity_mismatch'
        )
        sendJson(req, res, 409, {
          error: 'The CSS account result did not match the reserved identity.',
          code: 'provisioning_manual_review',
          operationId: sagaOperation.operation.operationId,
        })
        return
      }

      communityDirectory.seedRecord({
        webId: account.webId,
        podUrl: account.podUrl,
        issuer: ISSUER,
      })
      void communityDirectory.flush().catch((error) => {
        console.warn(
          '[community-directory] onboarding seed deferred:',
          error instanceof Error ? error.message : 'unknown error'
        )
      })
      rememberKnownSolidEmail(email)

      // P3: on MainNet there is no Friendbot, so the member's Stellar account
      // must be Treasury-funded before they can author on-chain operations
      // (e.g. register_webid). Idempotent + fail-closed: a funding failure aborts
      // onboarding so we never hand back an account the member cannot use.
      if (TREASURY_FUND_MEMBERS && !resumeMaterial.treasuryFunded) {
        try {
          await treasuryCreateAccount(stellarPublicKey)
          treasuryFunded = true
          resumeMaterial = { ...resumeMaterial, treasuryFunded: true }
          sagaOperation = await provisioningStore.checkpointResumeMaterial(
            sagaOperation,
            sagaLease,
            resumeMaterial
          )
        } catch (fundErr) {
          const message =
            fundErr instanceof Error ? fundErr.message : 'Treasury member funding failed.'
          sagaOperation = await provisioningStore.releaseLease(sagaOperation, sagaLease)
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
      let lockbox = resumeMaterial.lockbox
      let attestation = resumeMaterial.attestation ?? null
      if (sagaOperation.operation.state === 'client_credentials_created') {
        try {
          const renewed = await provisioningStore.renewLease(
            sagaOperation,
            sagaLease,
            PROVISIONING_LEASE_TTL_MS
          )
          sagaOperation = renewed.operation
          sagaLease = renewed.lease
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
            ...(bridgeProof ? { bridgeProof } : {}),
          })
          if (lockbox.status !== 'ready' || !lockbox.userLockboxContractId) {
            throw new Error(lockbox.error ?? 'Per-user lockb0x anchoring failed.')
          }

          // Phase E: anchor the REAL ZK attestation — the identity commitment
          // (Poseidon(identitySecret)) plus the Stellar-encrypted claim ciphertext —
          // into the lockb0x via `set_attestation` (Deployer = operator). The client
          // produces these on-device from a verified `pod_ownership` proof.
          if (accountCommitmentHex && ciphertextHex) {
            if (LOCKBOX_FACTORY_VERSION !== 'v3') {
              await anchorAttestation(
                lockbox.userLockboxContractId,
                accountCommitmentHex,
                ciphertextHex
              )
            }
            attestation = {
              accountCommitmentHex: accountCommitmentHex.toLowerCase().replace(/^0x/, ''),
              ciphertextSha256Hex: createHash('sha256')
                .update(Buffer.from(ciphertextHex.replace(/^0x/, ''), 'hex'))
                .digest('hex'),
            }
          }
          resumeMaterial = { ...resumeMaterial, lockbox, attestation }
          sagaOperation = await provisioningStore.transition(
            sagaOperation,
            sagaLease,
            'lockbox_ready',
            { resumeMaterial }
          )
        } catch (lockboxError) {
          sagaOperation = await provisioningStore
            .markManualReview(sagaOperation, 'lockbox_result_unknown')
            .catch(() => sagaOperation)
          throw lockboxError
        }
      }

      // Persist the per-user client credentials (encrypted) together with the
      // on-chain anchor metadata. These are the only durable Solid access
      // material; deleting this record is the server-side revocation path for
      // every session of this user, and the lockbox fields let returning-user
      // login return the anchor for the client-side fail-closed check.
      if (sagaOperation.operation.state === 'lockbox_ready') {
        await credentialStore.save({
          webId: account.webId,
          podUrl: account.podUrl,
          stellarPublicKey,
          clientCredentialsId: account.clientCredentialsId,
          clientCredentialsSecret: account.clientCredentialsSecret,
          userLockboxContractId: lockbox?.userLockboxContractId ?? null,
          lockboxFactoryContractId: lockbox?.factoryContractId ?? null,
          proofRootHex: lockbox?.proofRootHex ?? null,
        })
        sagaOperation = await provisioningStore.transition(
          sagaOperation,
          sagaLease,
          'credential_committed',
          {
            resumeMaterial: {
              account: { webId: account.webId, podUrl: account.podUrl },
              ...(lockbox ? { lockbox } : {}),
              attestation,
              treasuryFunded: resumeMaterial.treasuryFunded ?? treasuryFunded,
            } satisfies SolidAccountResumeMaterial,
          }
        )
        resumeMaterial = provisioningStore.decryptResumeMaterial<SolidAccountResumeMaterial>(
          sagaOperation.operation
        )
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
      let accountDocumentUrl = resumeMaterial.accountDocumentUrl ?? null
      if (!replayingCompletedOperation) {
        try {
          accountDocumentUrl = await writePodAccountDocument(
            SOLID_CSS_BASE_URL,
            { id: account.clientCredentialsId, secret: account.clientCredentialsSecret },
            account.podUrl,
            accountRecord
          )
        } catch (writeErr) {
          // Surface in logs but do not fail onboarding; the lockb0x is authoritative.
          console.warn('[solid-account] Pod account document write failed:', writeErr)
        }
        resumeMaterial = { ...resumeMaterial, accountDocumentUrl }
        sagaOperation = await provisioningStore.checkpointResumeMaterial(
          sagaOperation,
          sagaLease,
          resumeMaterial
        )
      }

      // Allocate + fill the WebID profile-card anchor slot with the on-chain
      // bindings (lockb0x, Stellar account, ZK identity commitment) so the
      // attestation is discoverable from the WebID. Best-effort: the on-chain
      // lockb0x remains authoritative, so a PATCH failure does not fail onboarding.
      if (!replayingCompletedOperation && attestation && lockbox?.userLockboxContractId) {
        try {
          await patchPodProfileAnchor(
            SOLID_CSS_BASE_URL,
            { id: account.clientCredentialsId, secret: account.clientCredentialsSecret },
            account.webId,
            {
              lockboxContractId: lockbox.userLockboxContractId,
              stellarPublicKey,
              accountCommitmentHex: attestation.accountCommitmentHex,
            }
          )
        } catch (patchErr) {
          console.warn('[solid-account] Pod profile-card anchor PATCH failed:', patchErr)
        }
      }

      // Session invariant (fail-closed): the response only reports success
      // after the stored credentials produced a live Solid token AND the Pod
      // answered a probe. The user lands in the app already authenticated —
      // there is no separate login leg and no browser↔CSS interaction.
      let session: ReturnType<SessionTokenManager['issue']>
      try {
        const renewed = await provisioningStore.renewLease(
          sagaOperation,
          sagaLease,
          PROVISIONING_LEASE_TTL_MS
        )
        sagaOperation = renewed.operation
        sagaLease = renewed.lease
        session = await issueVerifiedSession({
          webId: account.webId,
          podUrl: account.podUrl,
          stellarPublicKey,
          credentials: { id: account.clientCredentialsId, secret: account.clientCredentialsSecret },
        })
      } catch (sessionErr) {
        const message =
          sessionErr instanceof Error ? sessionErr.message : 'Session issuance failed.'
        sagaOperation = await provisioningStore.releaseLease(sagaOperation, sagaLease)
        sendJson(req, res, 502, {
          error: `Account was created but Solid access could not be verified: ${message}`,
          webId: account.webId,
          podUrl: account.podUrl,
        })
        return
      }
      if (sagaOperation.operation.state === 'credential_committed') {
        sagaOperation = await provisioningStore.transition(
          sagaOperation,
          sagaLease,
          'session_verified'
        )
      }

      const lockboxResponse = {
        userLockboxContractId: lockbox?.userLockboxContractId ?? null,
        factoryContractId: lockbox?.factoryContractId ?? null,
        proofRootHex: lockbox?.proofRootHex ?? null,
      }
      const browserSessionHeaders = await issueBrowserSessionCookie({
        webId: account.webId,
        podUrl: account.podUrl,
        stellarPublicKey: stellarPublicKey || null,
        lockbox: lockboxResponse,
      })
      if (sagaOperation.operation.state === 'session_verified') {
        await provisioningStore.commitReservations(sagaOperation, sagaLease)
        sagaOperation = await provisioningStore.transition(sagaOperation, sagaLease, 'completed')
      }
      sagaOperation = await provisioningStore.releaseLease(sagaOperation, sagaLease)
      sendJson(
        req,
        res,
        200,
        {
          status: 'ready',
          webId: account.webId,
          podUrl: account.podUrl,
          stellarPublicKey: stellarPublicKey || null,
          accountDocumentUrl,
          session,
          lockbox: lockbox ?? null,
          attestation,
        },
        browserSessionHeaders
      )

      if (!replayingCompletedOperation) {
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
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Solid account provisioning failed.'
      if (err instanceof ProvisioningConflictError) {
        sendJson(req, res, 409, {
          error: message,
          code: err.code,
          ...(sagaOperation ? { operationId: sagaOperation.operation.operationId } : {}),
        })
        return
      }
      if (err instanceof ConditionalWriteError) {
        sendJson(req, res, 409, {
          error: 'Provisioning changed concurrently. Retry the request.',
          code: 'provisioning_in_progress',
          ...(sagaOperation ? { operationId: sagaOperation.operation.operationId } : {}),
        })
        return
      }
      if (sagaOperation?.operation.state === 'manual_review') {
        sendJson(req, res, 409, {
          error: message,
          code: 'provisioning_manual_review',
          operationId: sagaOperation.operation.operationId,
        })
        return
      }
      if (isDuplicateEmailProvisioningMessage(message) && isNonEmpty(body.email)) {
        rememberKnownSolidEmail(body.email)
        sendJson(req, res, 409, { error: 'There already is a login for this e-mail address.' })
        return
      }
      sendJson(req, res, 502, { error: message })
    }
    return
  }

  // ---------------------------------------------------------------------------
  // Stellar Auth: challenge / login / refresh / logout endpoints
  // ---------------------------------------------------------------------------

  if (req.method === 'POST' && url.pathname === '/v1/auth/stellar-challenge') {
    const body = await readJsonBody<StellarChallengeRequest>(req)
    if (!isNonEmpty(body.stellarPublicKey)) {
      sendJson(req, res, 400, { error: 'stellarPublicKey is required.' })
      return
    }
    // Validate G-key format (Stellar public key: 56 chars, starts with G).
    const pk = body.stellarPublicKey.trim()
    if (pk.length !== 56 || !pk.startsWith('G')) {
      sendJson(req, res, 400, {
        error: 'stellarPublicKey must be a valid Stellar G-key (56 chars).',
      })
      return
    }
    // The Stellar keypair is the sole user credential: no webId is required.
    // Identity resolution happens server-side via the credential index after
    // the signature verifies.
    const challenge = store.issueStellarChallenge({ stellarPublicKey: pk })
    sendJson(req, res, 200, challenge)
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/stellar-token') {
    const body = await readJsonBody<StellarTokenRequest>(req)
    if (!isNonEmpty(body.challengeId)) {
      sendJson(req, res, 400, { error: 'challengeId is required.' })
      return
    }
    if (!isNonEmpty(body.stellarPublicKey)) {
      sendJson(req, res, 400, { error: 'stellarPublicKey is required.' })
      return
    }
    if (!isNonEmpty(body.signatureBase64)) {
      sendJson(req, res, 400, { error: 'signatureBase64 is required.' })
      return
    }

    const challenge = store.consumeStellarChallenge(body.challengeId.trim())
    if (!challenge) {
      sendJson(req, res, 400, { error: 'Challenge not found or has expired.' })
      return
    }
    if (challenge.stellarPublicKey !== body.stellarPublicKey.trim()) {
      sendJson(req, res, 400, { error: 'stellarPublicKey does not match the challenge.' })
      return
    }

    // Verify the Stellar Ed25519 signature. The signed payload is:
    //   JSON.stringify({ nonce, stellarPublicKey, audience })
    // The private key never leaves the device; only the public key + signature arrive here.
    const signedPayload = JSON.stringify({
      nonce: challenge.nonce,
      stellarPublicKey: challenge.stellarPublicKey,
      audience: STELLAR_AUTH_AUDIENCE,
    })
    const signatureValid = await verifyStellarEd25519(
      challenge.stellarPublicKey,
      signedPayload,
      body.signatureBase64.trim()
    )
    if (!signatureValid) {
      sendJson(req, res, 401, { error: 'Stellar signature verification failed.' })
      return
    }

    // Fail-closed login: a NodeZero session is issued only when stored client
    // credentials exist AND they produce a live Solid token AND the Pod
    // answers a probe. Anything else is 401 — there is no degraded state.
    const candidateCredentials = await credentialStore
      .findAllByStellarPublicKey(challenge.stellarPublicKey)
      .catch(() => [])
    if (candidateCredentials.length === 0) {
      sendJson(req, res, 401, {
        error: 'No NodeZero account exists for this identity. Create your node to continue.',
        code: 'no_account',
      })
      return
    }

    let credentials = candidateCredentials[0]
    if (isNonEmpty(body.webId)) {
      const requestedWebId = body.webId.trim()
      const matchedCredentials = candidateCredentials.find(
        (candidate) => candidate.webId === requestedWebId
      )
      if (!matchedCredentials) {
        sendJson(req, res, 404, {
          error: 'Selected account was not found for this Stellar identity.',
          code: 'account_not_found',
        })
        return
      }
      credentials = matchedCredentials
    } else if (candidateCredentials.length > 1) {
      sendJson(req, res, 409, {
        error:
          'Multiple NodeZero accounts found for this Stellar identity. Choose an account to continue.',
        code: 'account_selection_required',
        accounts: candidateCredentials.map((candidate) => ({
          webId: candidate.webId,
          podUrl: candidate.podUrl,
        })),
      })
      return
    }

    try {
      const session = await issueVerifiedSession({
        webId: credentials.webId,
        podUrl: credentials.podUrl,
        stellarPublicKey: challenge.stellarPublicKey,
        credentials: {
          id: credentials.clientCredentialsId,
          secret: credentials.clientCredentialsSecret,
        },
      })
      const lockbox = {
        userLockboxContractId: credentials.userLockboxContractId,
        factoryContractId: credentials.lockboxFactoryContractId,
        proofRootHex: credentials.proofRootHex,
      }
      const browserSessionHeaders = await issueBrowserSessionCookie({
        webId: credentials.webId,
        podUrl: credentials.podUrl,
        stellarPublicKey: challenge.stellarPublicKey,
        lockbox,
      })
      sendJson(
        req,
        res,
        200,
        {
          session,
          webId: credentials.webId,
          podUrl: credentials.podUrl,
          lockbox,
        },
        browserSessionHeaders
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Solid access verification failed.'
      console.warn('[auth:stellar-token] session issuance failed:', message)
      sendJson(req, res, 401, {
        error: 'Solid access could not be verified for this account.',
        code: 'session_unavailable',
      })
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/refresh') {
    const body = await readJsonBody<{ refreshToken?: string }>(req)
    if (!isNonEmpty(body.refreshToken)) {
      sendJson(req, res, 400, { error: 'refreshToken is required.' })
      return
    }

    const identity = sessions.consumeRefreshToken(body.refreshToken.trim())
    if (!identity) {
      sendJson(req, res, 401, {
        error: 'Refresh token is invalid or expired.',
        code: 'session_invalid',
      })
      return
    }

    // Refresh re-proves the invariant: credentials must still resolve and
    // still mint a working Solid token. Revoked users cannot refresh.
    const credentials = await credentialStore.findByWebId(identity.webId).catch(() => null)
    if (!credentials) {
      sendJson(req, res, 401, { error: 'This session has been revoked.', code: 'session_invalid' })
      return
    }

    try {
      const session = await issueVerifiedSession({
        webId: credentials.webId,
        podUrl: credentials.podUrl,
        stellarPublicKey: identity.stellarPublicKey,
        credentials: {
          id: credentials.clientCredentialsId,
          secret: credentials.clientCredentialsSecret,
        },
      })
      const lockbox = {
        userLockboxContractId: credentials.userLockboxContractId,
        factoryContractId: credentials.lockboxFactoryContractId,
        proofRootHex: credentials.proofRootHex,
      }
      const browserSessionHeaders = await issueBrowserSessionCookie({
        webId: credentials.webId,
        podUrl: credentials.podUrl,
        stellarPublicKey: identity.stellarPublicKey,
        lockbox,
      })
      sendJson(
        req,
        res,
        200,
        {
          session,
          webId: credentials.webId,
          podUrl: credentials.podUrl,
          lockbox,
        },
        browserSessionHeaders
      )
    } catch {
      sendJson(req, res, 401, {
        error: 'Solid access could not be verified for this account.',
        code: 'session_invalid',
      })
    }
    return
  }

  if (req.method === 'GET' && url.pathname === '/v1/auth/browser-session') {
    if (!BROWSER_SESSION_ENABLED) {
      sendJson(req, res, 404, { error: 'Browser-session bootstrap is not enabled.' })
      return
    }
    if (!isAllowedBrowserOrigin(req)) {
      sendJson(req, res, 403, {
        error: 'Browser session bootstrap requires an allowed first-party origin.',
      })
      return
    }
    const token = readCookie(req, BROWSER_SESSION_COOKIE_NAME)
    if (!token) {
      sendJson(
        req,
        res,
        401,
        { error: 'Browser session is missing.', code: 'session_invalid' },
        clearBrowserSessionCookie()
      )
      return
    }
    const browserSession = await credentialStore.findBrowserSession(token).catch(() => null)
    if (!browserSession) {
      sendJson(
        req,
        res,
        401,
        { error: 'Browser session is invalid or expired.', code: 'session_invalid' },
        clearBrowserSessionCookie()
      )
      return
    }
    const credentials = await credentialStore.findByWebId(browserSession.webId).catch(() => null)
    if (!credentials) {
      await credentialStore.revokeBrowserSession(token)
      sendJson(
        req,
        res,
        401,
        { error: 'Browser session has been revoked.', code: 'session_invalid' },
        clearBrowserSessionCookie()
      )
      return
    }
    try {
      const session = await issueVerifiedSession({
        webId: credentials.webId,
        podUrl: credentials.podUrl,
        stellarPublicKey: credentials.stellarPublicKey,
        credentials: {
          id: credentials.clientCredentialsId,
          secret: credentials.clientCredentialsSecret,
        },
      })
      await credentialStore.revokeBrowserSession(token)
      const lockbox = {
        userLockboxContractId: credentials.userLockboxContractId,
        factoryContractId: credentials.lockboxFactoryContractId,
        proofRootHex: credentials.proofRootHex,
      }
      const browserSessionHeaders = await issueBrowserSessionCookie({
        webId: credentials.webId,
        podUrl: credentials.podUrl,
        stellarPublicKey: credentials.stellarPublicKey,
        lockbox,
      })
      sendJson(
        req,
        res,
        200,
        { session, webId: credentials.webId, podUrl: credentials.podUrl, lockbox },
        browserSessionHeaders
      )
    } catch {
      sendJson(
        req,
        res,
        401,
        { error: 'Solid access could not be verified for this account.', code: 'session_invalid' },
        clearBrowserSessionCookie()
      )
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
    const body = await readJsonBody<{ refreshToken?: string; webId?: string }>(req).catch(
      () => ({}) as { refreshToken?: string; webId?: string }
    )
    if (isNonEmpty(body.refreshToken)) {
      sessions.consumeRefreshToken(body.refreshToken.trim())
    }
    if (isNonEmpty(body.webId)) {
      sessions.revokeByWebId(body.webId.trim())
      await credentialStore.revokeBrowserSessionsByWebId(body.webId.trim())
    }
    const cookie = readCookie(req, BROWSER_SESSION_COOKIE_NAME)
    if (cookie) await credentialStore.revokeBrowserSession(cookie)
    sendJson(req, res, 200, { status: 'ok' }, clearBrowserSessionCookie())
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/revoke') {
    // Server-side session revocation (operator action): deletes the stored
    // client credentials so every live and future session for the WebID fails
    // closed at the proxy / refresh / login. Internal-key protected.
    if (!INTERNAL_API_KEY) {
      sendJson(req, res, 503, {
        error: 'Session revocation is not enabled (JSS_INTERNAL_API_KEY).',
      })
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

    const webId = body.webId.trim()
    const credentialsRemoved = await credentialStore.revokeByWebId(webId)
    const refreshTokensRevoked = sessions.revokeByWebId(webId)
    evictPodTokenCache(webId)
    sendJson(req, res, 200, { status: 'ok', credentialsRemoved, refreshTokensRevoked })
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/create-account') {
    // P3: Treasury-sponsored member account creation. Privileged, funds-moving,
    // and disabled unless an internal API key is configured (fail-closed).
    if (!INTERNAL_API_KEY) {
      sendJson(req, res, 503, {
        error: 'Treasury account creation is not enabled (JSS_INTERNAL_API_KEY).',
      })
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
      sendJson(req, res, 400, {
        error: 'stellarPublicKey must be a valid Stellar public key (G...).',
      })
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

function ifNoneMatchMatches(value: string | undefined, currentEtag: string): boolean {
  if (!value) return false
  if (value.trim() === '*') return true
  const currentOpaque = currentEtag.replace(/^W\//, '')
  return value
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .some((candidate) => candidate === currentOpaque)
}

export function createRequestHandler(overrides: RequestHandlerOverrides = {}) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    handleHttpRequest(req, res, overrides).catch((err) => {
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
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[jss-provisioner] listening on 0.0.0.0:${PORT}`)
  })
}
