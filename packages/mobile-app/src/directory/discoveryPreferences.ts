import type {
  DiscoveryConsent,
  DiscoveryConsentManager,
  DiscoveryManifestManager,
  ProfileManager,
  ProfilePreferencesManager,
  PublicTypeIndexManager,
} from '@nodezero/solid-pod-sync'
import { publishDiscoveryConsentChanged } from './discoveryConsentEvents'

export interface DiscoveryPreferences {
  publicListing: boolean
  publicIndexing: boolean
  nearbyPresence: boolean
  localBroadcasts: boolean
  selectedPublicInterests: string[]
}

export interface UpdateDiscoveryPreferencesInput {
  podRoot: string
  ownerWebId: string
  preferences: DiscoveryPreferences
  baselineConsent: Pick<
    DiscoveryConsent,
    'publicListing' | 'publicIndexing' | 'nearbyPresence' | 'localBroadcasts'
  >
  provisionerUrl: string
  authFetch: typeof globalThis.fetch
  managers: {
    discoveryConsentManager: Pick<DiscoveryConsentManager, 'readConsent' | 'updateConsent'>
    discoveryManifestManager: Pick<
      DiscoveryManifestManager,
      'readManifest' | 'writeManifest' | 'removeManifest'
    >
    publicTypeIndexManager: Pick<
      PublicTypeIndexManager,
      | 'discoverPublicTypeIndex'
      | 'ensureDiscoveryManifestRegistration'
      | 'removeDiscoveryManifestRegistration'
    >
    profileManager: Pick<ProfileManager, 'readProfile'>
    profilePreferencesManager: Pick<ProfilePreferencesManager, 'readPreferences'>
  }
  now?: Date
  forcePublicIndexingOff?: boolean
  requirePublicTypeIndex?: boolean
  basicProfileOnly?: boolean
  preserveIndependentIndexingArtifacts?: boolean
}

export interface DiscoveryPreferencesResult {
  consent: DiscoveryConsent
  listed: boolean
  selectedPublicInterests: string[]
}

export class DiscoveryPreferencesError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'DiscoveryPreferencesError'
  }
}

const MANIFEST_TTL_MS = 7 * 24 * 60 * 60_000

export async function updateDiscoveryPreferences(
  input: UpdateDiscoveryPreferencesInput
): Promise<DiscoveryPreferencesResult> {
  const previousConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
  const now = input.now ?? new Date()
  const mergedPreferences = mergeConsentChanges(
    previousConsent,
    input.baselineConsent,
    input.preferences
  )
  if (input.forcePublicIndexingOff) mergedPreferences.publicIndexing = false
  if (previousConsent.publicListing && !mergedPreferences.publicListing) {
    await suppressDirectoryProjection(input.provisionerUrl, input.authFetch).catch(() => undefined)
  }
  const publish = mergedPreferences.publicListing || mergedPreferences.publicIndexing
  const privatePreferences = publish
    ? await input.managers.profilePreferencesManager.readPreferences(input.podRoot)
    : null
  const selectedPublicInterests = publish
    ? validateSelectedInterests(
        privatePreferences?.interests ?? [],
        input.preferences.selectedPublicInterests
      )
    : []
  const consentPatch: Parameters<
    UpdateDiscoveryPreferencesInput['managers']['discoveryConsentManager']['updateConsent']
  >[1] = {}
  const expectedConsent: typeof consentPatch = {}
  for (const key of [
    'publicListing',
    'publicIndexing',
    'nearbyPresence',
    'localBroadcasts',
  ] as const) {
    if (input.preferences[key] !== input.baselineConsent[key]) {
      consentPatch[key] = mergedPreferences[key]
      expectedConsent[key] = previousConsent[key]
    }
  }
  if (input.forcePublicIndexingOff && previousConsent.publicIndexing) {
    consentPatch.publicIndexing = false
    expectedConsent.publicIndexing = previousConsent.publicIndexing
  }
  const consent =
    Object.keys(consentPatch).length > 0
      ? await input.managers.discoveryConsentManager.updateConsent(
          input.podRoot,
          consentPatch,
          now.toISOString(),
          expectedConsent
        )
      : previousConsent
  publishDiscoveryConsentChanged(consent)
  if (consent.publicIndexing && input.preserveIndependentIndexingArtifacts) {
    const listed = await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
    return { consent, listed, selectedPublicInterests: [] }
  }
  if (!publish) {
    let cleanupFailed = false
    let manifestPublicTypeIndexUrl: string | null = null
    try {
      manifestPublicTypeIndexUrl =
        (await input.managers.discoveryManifestManager.readManifest(input.podRoot))
          ?.publicTypeIndexUrl ?? null
    } catch {
      cleanupFailed = true
    }
    try {
      const publicTypeIndexUrl =
        manifestPublicTypeIndexUrl ??
        (await input.managers.publicTypeIndexManager.discoverPublicTypeIndex(input.ownerWebId))
      if (publicTypeIndexUrl) {
        await input.managers.publicTypeIndexManager.removeDiscoveryManifestRegistration(
          input.podRoot,
          publicTypeIndexUrl
        )
      }
    } catch {
      cleanupFailed = true
    }
    try {
      await input.managers.discoveryManifestManager.removeManifest(input.podRoot)
    } catch {
      cleanupFailed = true
    }
    const listed = await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
    if (cleanupFailed) {
      throw new DiscoveryPreferencesError(
        'Discovery is disabled and the directory projection was removed, but public discovery cleanup failed.',
        'manifest_cleanup_failed'
      )
    }
    return { consent, listed, selectedPublicInterests }
  }

  const previousManifest = await input.managers.discoveryManifestManager
    .readManifest(input.podRoot)
    .catch(() => null)
  const profile = await input.managers.profileManager.readProfile(input.ownerWebId)
  const manifestUrl = `${input.podRoot.replace(/\/$/, '')}/public/discovery/manifest`
  let publicTypeIndexUrl: string | null
  try {
    publicTypeIndexUrl = await input.managers.publicTypeIndexManager.discoverPublicTypeIndex(
      input.ownerWebId
    )
    if (!publicTypeIndexUrl && input.requirePublicTypeIndex) {
      throw new DiscoveryPreferencesError(
        'Your public Type Index is unavailable for Directory publication.',
        'type_index_sync_failed'
      )
    }
  } catch {
    throw new DiscoveryPreferencesError(
      'Your public Type Index is unavailable for Directory publication.',
      'type_index_sync_failed'
    )
  }
  try {
    await input.managers.discoveryManifestManager.writeManifest(input.podRoot, {
      version: 1,
      webId: input.ownerWebId,
      publishedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MANIFEST_TTL_MS).toISOString(),
      ...(profile?.displayName ? { displayName: profile.displayName } : {}),
      ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      ...(publicTypeIndexUrl ? { publicTypeIndexUrl } : {}),
      ...(input.basicProfileOnly && consent.publicIndexing && previousManifest?.publicInterests
        ? { publicInterests: previousManifest.publicInterests }
        : {}),
      ...(input.basicProfileOnly && consent.publicIndexing && previousManifest?.capabilities
        ? { capabilities: previousManifest.capabilities }
        : {}),
      ...(input.basicProfileOnly && consent.publicIndexing && previousManifest?.inboxUrl
        ? { inboxUrl: previousManifest.inboxUrl }
        : {}),
      ...(!input.basicProfileOnly && consent.publicIndexing && selectedPublicInterests.length > 0
        ? { publicInterests: selectedPublicInterests }
        : {}),
      ...(!input.basicProfileOnly && consent.publicIndexing
        ? {
            capabilities: ['relationship-requests'],
            inboxUrl: `${input.podRoot.replace(/\/$/, '')}/social/inbox/`,
          }
        : {}),
    })
  } catch {
    const rollbackPatch: Partial<Pick<DiscoveryConsent, 'publicListing' | 'publicIndexing'>> = {}
    const rollbackExpected: typeof rollbackPatch = {}
    if (consent.publicListing && !previousConsent.publicListing) {
      rollbackPatch.publicListing = false
      rollbackExpected.publicListing = true
    }
    if (consent.publicIndexing && !previousConsent.publicIndexing) {
      rollbackPatch.publicIndexing = false
      rollbackExpected.publicIndexing = true
    }
    const conservativeConsent =
      Object.keys(rollbackPatch).length > 0
        ? await input.managers.discoveryConsentManager.updateConsent(
            input.podRoot,
            rollbackPatch,
            new Date().toISOString(),
            rollbackExpected
          )
        : await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    publishDiscoveryConsentChanged(conservativeConsent)
    await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
    throw new DiscoveryPreferencesError(
      'Public discovery changes were applied conservatively, but manifest publication failed.',
      'manifest_publish_failed'
    )
  }
  const afterManifestConsent = await input.managers.discoveryConsentManager.readConsent(
    input.podRoot
  )
  const afterManifestOptOut = await repairConcurrentFullOptOut(input, afterManifestConsent, [
    publicTypeIndexUrl,
    previousManifest?.publicTypeIndexUrl,
  ])
  if (afterManifestOptOut) return afterManifestOptOut
  try {
    if (publicTypeIndexUrl) {
      await input.managers.publicTypeIndexManager.ensureDiscoveryManifestRegistration(
        input.podRoot,
        publicTypeIndexUrl,
        manifestUrl
      )
    }
    if (
      previousManifest?.publicTypeIndexUrl &&
      previousManifest.publicTypeIndexUrl !== publicTypeIndexUrl
    ) {
      await input.managers.publicTypeIndexManager.removeDiscoveryManifestRegistration(
        input.podRoot,
        previousManifest.publicTypeIndexUrl
      )
    }
  } catch {
    throw new DiscoveryPreferencesError(
      'Your public Type Index is unavailable for Directory publication.',
      'type_index_sync_failed'
    )
  }
  const afterTypeIndexConsent = await input.managers.discoveryConsentManager.readConsent(
    input.podRoot
  )
  const afterTypeIndexOptOut = await repairConcurrentFullOptOut(input, afterTypeIndexConsent, [
    publicTypeIndexUrl,
    previousManifest?.publicTypeIndexUrl,
  ])
  if (afterTypeIndexOptOut) return afterTypeIndexOptOut
  const listed = await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
  return { consent, listed, selectedPublicInterests }
}

async function repairConcurrentFullOptOut(
  input: UpdateDiscoveryPreferencesInput,
  consent: DiscoveryConsent,
  typeIndexUrls: Array<string | null | undefined>
): Promise<DiscoveryPreferencesResult | null> {
  if (consent.publicListing || consent.publicIndexing) return null
  let cleanupFailed = false
  for (const publicTypeIndexUrl of new Set(typeIndexUrls.filter(isString))) {
    try {
      await input.managers.publicTypeIndexManager.removeDiscoveryManifestRegistration(
        input.podRoot,
        publicTypeIndexUrl
      )
    } catch {
      cleanupFailed = true
    }
  }
  try {
    await input.managers.discoveryManifestManager.removeManifest(input.podRoot)
  } catch {
    cleanupFailed = true
  }
  const listed = await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
  if (cleanupFailed) {
    throw new DiscoveryPreferencesError(
      'Discovery opt-out won, but public discovery cleanup is still pending.',
      'manifest_cleanup_failed'
    )
  }
  return { consent, listed, selectedPublicInterests: [] }
}

function isString(value: string | null | undefined): value is string {
  return typeof value === 'string'
}

function mergeConsentChanges(
  current: DiscoveryConsent,
  baseline: UpdateDiscoveryPreferencesInput['baselineConsent'],
  desired: DiscoveryPreferences
): UpdateDiscoveryPreferencesInput['baselineConsent'] {
  return {
    publicListing:
      desired.publicListing === baseline.publicListing
        ? current.publicListing
        : desired.publicListing,
    publicIndexing:
      desired.publicIndexing === baseline.publicIndexing
        ? current.publicIndexing
        : desired.publicIndexing,
    nearbyPresence:
      desired.nearbyPresence === baseline.nearbyPresence
        ? current.nearbyPresence
        : desired.nearbyPresence,
    localBroadcasts:
      desired.localBroadcasts === baseline.localBroadcasts
        ? current.localBroadcasts
        : desired.localBroadcasts,
  }
}

function validateSelectedInterests(privateInterests: string[], selected: string[]): string[] {
  const privateByKey = new Map(
    privateInterests.map((value) => [value.trim().toLowerCase(), value.trim()])
  )
  const output: string[] = []
  const seen = new Set<string>()
  for (const value of selected) {
    const key = value.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    const privateValue = privateByKey.get(key)
    if (!privateValue) {
      throw new DiscoveryPreferencesError(
        'Public interests must be explicitly selected from private profile interests.',
        'public_interest_not_owned'
      )
    }
    seen.add(key)
    output.push(privateValue)
  }
  return output
}

export async function refreshDirectoryProjection(
  provisionerUrl: string,
  authFetch: typeof globalThis.fetch
): Promise<boolean> {
  const baseUrl = provisionerUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) {
    throw new DiscoveryPreferencesError(
      'Community directory refresh is not configured.',
      'directory_refresh_unconfigured'
    )
  }
  let response: Response
  try {
    response = await authFetch(`${baseUrl}/v1/community-directory/refresh`, {
      method: 'POST',
      headers: { accept: 'application/json' },
    })
  } catch {
    throw new DiscoveryPreferencesError(
      'Community directory refresh is temporarily unavailable.',
      'directory_refresh_unavailable'
    )
  }
  const payload = (await response.json().catch(() => ({}))) as {
    listed?: unknown
    code?: unknown
    error?: unknown
  }
  if (!response.ok) {
    throw new DiscoveryPreferencesError(
      typeof payload.error === 'string' ? payload.error : 'Community directory refresh failed.',
      typeof payload.code === 'string' ? payload.code : 'directory_refresh_failed'
    )
  }
  if (typeof payload.listed !== 'boolean') {
    throw new DiscoveryPreferencesError(
      'Community directory refresh returned an invalid response.',
      'directory_refresh_invalid'
    )
  }
  return payload.listed
}

export async function suppressDirectoryProjection(
  provisionerUrl: string,
  authFetch: typeof globalThis.fetch
): Promise<void> {
  const baseUrl = provisionerUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) {
    throw new DiscoveryPreferencesError(
      'Community directory suppression is not configured.',
      'directory_suppress_unconfigured'
    )
  }
  let response: Response
  try {
    response = await authFetch(`${baseUrl}/v1/community-directory/suppress`, {
      method: 'POST',
      headers: { accept: 'application/json' },
    })
  } catch {
    throw new DiscoveryPreferencesError(
      'Community directory suppression is temporarily unavailable.',
      'directory_suppress_unavailable'
    )
  }
  const payload = (await response.json().catch(() => ({}))) as {
    listed?: unknown
    code?: unknown
    error?: unknown
  }
  if (!response.ok || payload.listed !== false) {
    throw new DiscoveryPreferencesError(
      typeof payload.error === 'string' ? payload.error : 'Community directory suppression failed.',
      typeof payload.code === 'string' ? payload.code : 'directory_suppress_failed'
    )
  }
}
