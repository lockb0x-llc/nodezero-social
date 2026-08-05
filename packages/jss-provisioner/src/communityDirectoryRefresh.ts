import { DiscoveryConsentManager, DiscoveryManifestManager } from '@nodezero/solid-pod-sync'
import type { CommunityDirectoryRecord, CommunityDirectoryStore } from './communityDirectory.js'
import type { CredentialStore } from './credentialStore.js'
import type { SessionClaims } from './sessionTokens.js'
import { mintPodAccessToken, type PodAccessToken } from './solidAccount.js'

export interface CommunityDirectoryRefreshOptions {
  credentialStore: Pick<CredentialStore, 'findByWebId'>
  directoryStore: Pick<
    CommunityDirectoryStore,
    'refreshProjection' | 'reloadRecord' | 'flush' | 'getByWebId'
  >
  cssBaseUrl: string
  mintToken?: typeof mintPodAccessToken
  now?: Date
  allowListing?: boolean
}

export class CommunityDirectoryRefreshError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'CommunityDirectoryRefreshError'
  }
}

export async function refreshCommunityDirectoryProjection(
  claims: SessionClaims,
  options: CommunityDirectoryRefreshOptions
): Promise<CommunityDirectoryRecord> {
  await options.directoryStore.reloadRecord(claims.sub)
  const podRoot = normalizedPodRoot(claims.pod, options.cssBaseUrl)
  const credentials = await options.credentialStore.findByWebId(claims.sub)
  if (!credentials) {
    throw new CommunityDirectoryRefreshError(
      'Session Pod credentials are unavailable.',
      'session_invalid'
    )
  }
  const token = await (options.mintToken ?? mintPodAccessToken)(options.cssBaseUrl, {
    id: credentials.clientCredentialsId,
    secret: credentials.clientCredentialsSecret,
  })
  const manifestUrl = `${podRoot.toString()}public/discovery/manifest`
  let sourceRevision: string | undefined
  const ownerFetch = createOwnerPodReadFetch(token, podRoot, (url, response) => {
    if (url === manifestUrl) sourceRevision = response.headers.get('etag') ?? undefined
  })
  const consent = await new DiscoveryConsentManager({ fetch: ownerFetch }).readConsent(
    podRoot.toString(),
    options.now
  )
  if (consent.ownerWebId !== claims.sub) {
    throw new CommunityDirectoryRefreshError(
      'Discovery consent owner does not match the authenticated session.',
      'consent_owner_mismatch'
    )
  }

  let manifest = null
  if (consent.publicListing || consent.publicIndexing) {
    try {
      manifest = await new DiscoveryManifestManager({ fetch: ownerFetch }).readManifest(
        podRoot.toString()
      )
      if (manifest && manifest.webId !== claims.sub) manifest = null
    } catch (error) {
      if (isManifestValidationError(error)) manifest = null
      else throw error
    }
  }

  const record = options.directoryStore.refreshProjection({
    webId: claims.sub,
    podUrl: podRoot.toString(),
    issuer: podRoot.origin,
    publicListing: consent.publicListing && options.allowListing !== false,
    publicIndexing: consent.publicIndexing,
    consentUpdatedAt: consent.updatedAt,
    ...(typeof consent.revision === 'number' ? { consentRevision: consent.revision } : {}),
    manifest,
    manifestUrl,
    ...(sourceRevision ? { sourceRevision } : {}),
    ...(options.now ? { now: options.now } : {}),
  })
  try {
    await options.directoryStore.flush()
  } catch (error) {
    await options.directoryStore.reloadRecord(claims.sub).catch(() => undefined)
    throw error
  }
  await options.directoryStore.reloadRecord(claims.sub)
  return options.directoryStore.getByWebId(claims.sub) ?? record
}

function isManifestValidationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('Discovery manifest contract validation failed') ||
      error.message.includes('Discovery manifest owner mismatch'))
  )
}

function normalizedPodRoot(podUrl: string, cssBaseUrl: string): URL {
  let podRoot: URL
  let cssBase: URL
  try {
    podRoot = new URL(podUrl.endsWith('/') ? podUrl : `${podUrl}/`)
    cssBase = new URL(cssBaseUrl.endsWith('/') ? cssBaseUrl : `${cssBaseUrl}/`)
  } catch {
    throw new CommunityDirectoryRefreshError(
      'Directory refresh Pod configuration is invalid.',
      'pod_configuration_invalid'
    )
  }
  if (podRoot.origin !== cssBase.origin) {
    throw new CommunityDirectoryRefreshError(
      'Session Pod origin does not match the configured Pod server.',
      'pod_origin_mismatch'
    )
  }
  return podRoot
}

function createOwnerPodReadFetch(
  token: PodAccessToken,
  podRoot: URL,
  observe: (url: string, response: Response) => void
): typeof globalThis.fetch {
  return async (input, init) => {
    const target = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url
    )
    if (target.origin !== podRoot.origin || !target.pathname.startsWith(podRoot.pathname)) {
      throw new CommunityDirectoryRefreshError(
        'Directory refresh escaped the authenticated Pod namespace.',
        'pod_scope_denied'
      )
    }
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      throw new CommunityDirectoryRefreshError(
        'Directory refresh Pod access is read-only.',
        'pod_method_denied'
      )
    }
    const headers = new Headers(init?.headers)
    headers.set('authorization', `DPoP ${token.accessToken}`)
    headers.set('dpop', token.proof(target.toString(), method))
    const response = await fetch(target, { ...init, method, headers })
    observe(target.toString(), response)
    return response
  }
}
