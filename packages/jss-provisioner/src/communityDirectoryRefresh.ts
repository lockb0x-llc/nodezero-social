import {
  DISCOVERY_MANIFEST_CLASS,
  DiscoveryConsentManager,
  DiscoveryManifestManager,
  PublicTypeIndexManager,
} from '@nodezero/solid-pod-sync'
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
  expectedPublicationRevision?: number
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
  let token: PodAccessToken
  try {
    token = await (options.mintToken ?? mintPodAccessToken)(options.cssBaseUrl, {
      id: credentials.clientCredentialsId,
      secret: credentials.clientCredentialsSecret,
    })
  } catch {
    throw new CommunityDirectoryRefreshError(
      'Session Pod access could not be established.',
      'session_invalid'
    )
  }
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
  if (
    typeof options.expectedPublicationRevision === 'number' &&
    (consent.publicationRevision ?? 0) !== options.expectedPublicationRevision
  ) {
    throw new CommunityDirectoryRefreshError(
      'Discovery publication changed before suppression.',
      'publication_changed'
    )
  }

  let manifest = null
  if (
    typeof consent.publicationRevision === 'number' &&
    (consent.publicListing || consent.publicIndexing) &&
    options.allowListing !== false
  ) {
    try {
      manifest = await new DiscoveryManifestManager({ fetch: ownerFetch }).readManifest(
        podRoot.toString()
      )
      if (
        manifest &&
        (manifest.webId !== claims.sub ||
          manifest.publicationRevision !== consent.publicationRevision)
      ) {
        manifest = null
      }
      if (manifest) {
        const publicTypeIndexUrl = manifest.publicTypeIndexUrl
        if (!publicTypeIndexUrl) {
          manifest = null
        } else {
          const typeIndexManager = new PublicTypeIndexManager({ fetch: ownerFetch })
          const authoritativeTypeIndexUrl = await typeIndexManager.discoverPublicTypeIndex(
            claims.sub
          )
          if (authoritativeTypeIndexUrl !== publicTypeIndexUrl) {
            manifest = null
          } else {
            const registration = (
              await typeIndexManager.listRegistrations(publicTypeIndexUrl, {
                requirePublicIndexTypes: true,
              })
            ).find(
              (candidate) =>
                candidate.forClass === DISCOVERY_MANIFEST_CLASS &&
                candidate.instance === manifestUrl
            )
            if (
              !registration ||
              registration.publicationRevision !== consent.publicationRevision
            ) {
              manifest = null
            }
          }
        }
      }
    } catch (error) {
      if (
        error instanceof CommunityDirectoryRefreshError &&
        error.code === 'session_invalid'
      ) {
        throw error
      }
      manifest = null
    }
  }

  if (
    options.allowListing === false &&
    typeof options.expectedPublicationRevision === 'number'
  ) {
    const suppressionConsent = await new DiscoveryConsentManager({ fetch: ownerFetch }).readConsent(
      podRoot.toString(),
      options.now
    )
    if (
      (suppressionConsent.publicationRevision ?? 0) !==
      (options.expectedPublicationRevision ?? 0)
    ) {
      throw new CommunityDirectoryRefreshError(
        'Discovery publication changed before suppression.',
        'publication_changed'
      )
    }
  }

  const record = options.directoryStore.refreshProjection({
    webId: claims.sub,
    podUrl: podRoot.toString(),
    issuer: podRoot.origin,
    publicListing: consent.publicListing && options.allowListing !== false,
    publicIndexing: consent.publicIndexing,
    publicationUpdatedAt:
      consent.publicationUpdatedAt ?? manifest?.publishedAt ?? new Date(0).toISOString(),
    ...(typeof consent.publicationRevision === 'number'
      ? { publicationRevision: consent.publicationRevision }
      : {}),
    ...(!consent.publicListing ||
    typeof consent.publicationRevision !== 'number' ||
    options.allowListing === false
      ? { suppressed: true }
      : {}),
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
  await options.directoryStore.reloadRecord(claims.sub, true)
  if (
    options.allowListing === false &&
    typeof options.expectedPublicationRevision === 'number'
  ) {
    const finalConsent = await new DiscoveryConsentManager({ fetch: ownerFetch }).readConsent(
      podRoot.toString(),
      options.now
    )
    if (
      (finalConsent.publicationRevision ?? 0) !==
      (options.expectedPublicationRevision ?? 0)
    ) {
      const reconciliationOptions: CommunityDirectoryRefreshOptions = {
        ...options,
        allowListing: true,
      }
      delete reconciliationOptions.expectedPublicationRevision
      await refreshCommunityDirectoryProjection(claims, reconciliationOptions)
      throw new CommunityDirectoryRefreshError(
        'Discovery publication changed during suppression.',
        'publication_changed'
      )
    }
  }
  return options.directoryStore.getByWebId(claims.sub) ?? record
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
    if (response.status === 401) {
      throw new CommunityDirectoryRefreshError(
        'Session Pod access was rejected.',
        'session_invalid'
      )
    }
    observe(target.toString(), response)
    return response
  }
}
