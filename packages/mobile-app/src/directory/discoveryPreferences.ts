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
    discoveryConsentManager: Pick<
      DiscoveryConsentManager,
      'readConsent' | 'updateConsent' | 'reservePublicationRevision'
    >
    discoveryManifestManager: Pick<
      DiscoveryManifestManager,
      'readManifest' | 'writeManifest' | 'removeManifestIfUnchanged'
    >
    publicTypeIndexManager: Pick<
      PublicTypeIndexManager,
      | 'discoverPublicTypeIndex'
      | 'ensurePublicTypeIndex'
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
    await suppressDirectoryProjection(
      input.provisionerUrl,
      input.authFetch,
      previousConsent.publicationRevision ?? 0
    )
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
    const publicationConsent =
      await input.managers.discoveryConsentManager.reservePublicationRevision(
        input.podRoot,
        consent.publicationRevision,
        now.toISOString(),
        {
          publicListing: consent.publicListing,
          publicIndexing: consent.publicIndexing,
        }
      )
    publishDiscoveryConsentChanged(publicationConsent)
    const previousManifest = await input.managers.discoveryManifestManager
      .readManifest(input.podRoot)
      .catch(() => null)
    const profile = await input.managers.profileManager.readProfile(input.ownerWebId)
    const publicTypeIndexUrl =
      (await input.managers.publicTypeIndexManager.discoverPublicTypeIndex(input.ownerWebId)) ??
      previousManifest?.publicTypeIndexUrl ??
      null
    if (!publicTypeIndexUrl) {
      throw new DiscoveryPreferencesError(
        'Your public Type Index is unavailable for public indexing.',
        'type_index_sync_failed'
      )
    }
    await input.managers.discoveryManifestManager.writeManifest(input.podRoot, {
      version: 1,
      webId: input.ownerWebId,
      ...(typeof publicationConsent.publicationRevision === 'number'
        ? { publicationRevision: publicationConsent.publicationRevision }
        : {}),
      publishedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MANIFEST_TTL_MS).toISOString(),
      ...(profile?.displayName ? { displayName: profile.displayName } : {}),
      ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      publicTypeIndexUrl,
      ...(previousManifest?.publicInterests
        ? { publicInterests: previousManifest.publicInterests }
        : {}),
      ...(previousManifest?.capabilities
        ? { capabilities: previousManifest.capabilities }
        : {}),
      ...(previousManifest?.inboxUrl ? { inboxUrl: previousManifest.inboxUrl } : {}),
    })
    const afterManifestConsent = await input.managers.discoveryConsentManager.readConsent(
      input.podRoot
    )
    const afterManifestSuperseded = await reconcileSupersededPublication(
      input,
      publicationConsent,
      afterManifestConsent,
      [publicTypeIndexUrl, previousManifest?.publicTypeIndexUrl],
      []
    )
    if (afterManifestSuperseded) return afterManifestSuperseded
    await input.managers.publicTypeIndexManager.ensureDiscoveryManifestRegistration(
      input.podRoot,
      publicTypeIndexUrl,
      `${input.podRoot.replace(/\/$/, '')}/public/discovery/manifest`,
      publicationConsent.publicationRevision
    )
    const afterTypeIndexConsent = await input.managers.discoveryConsentManager.readConsent(
      input.podRoot
    )
    const afterTypeIndexSuperseded = await reconcileSupersededPublication(
      input,
      publicationConsent,
      afterTypeIndexConsent,
      [publicTypeIndexUrl, previousManifest?.publicTypeIndexUrl],
      []
    )
    if (afterTypeIndexSuperseded) return afterTypeIndexSuperseded
    const listed = await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
    return { consent: publicationConsent, listed, selectedPublicInterests: [] }
  }
  if (!publish) {
    await suppressDirectoryProjection(
      input.provisionerUrl,
      input.authFetch,
      consent.publicationRevision ?? 0
    )
    let cleanupFailed = false
    let manifestPublicTypeIndexUrl: string | null = null
    let cleanupConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    if (isNewerPublicActivation(consent, cleanupConsent)) {
      const listed = await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
      return { consent: cleanupConsent, listed, selectedPublicInterests: [] }
    }
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
        const removed = await input.managers.publicTypeIndexManager.removeDiscoveryManifestRegistration(
          input.podRoot,
          publicTypeIndexUrl,
          cleanupConsent.publicationRevision ?? consent.publicationRevision ?? 0
        )
        if (!removed) cleanupFailed = true
      }
    } catch {
      cleanupFailed = true
    }
    try {
      cleanupConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
      if (isNewerPublicActivation(consent, cleanupConsent)) {
        const listed = await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
        return { consent: cleanupConsent, listed, selectedPublicInterests: [] }
      }
      const removed = await input.managers.discoveryManifestManager.removeManifestIfUnchanged(
        input.podRoot,
        cleanupConsent.publicationRevision ?? consent.publicationRevision ?? 0
      )
      if (!removed) cleanupFailed = true
    } catch {
      cleanupFailed = true
    }
    cleanupConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    if (isNewerPublicActivation(consent, cleanupConsent)) {
      const listed = await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
      return { consent: cleanupConsent, listed, selectedPublicInterests: [] }
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

  const publicationConsent =
    await input.managers.discoveryConsentManager.reservePublicationRevision(
      input.podRoot,
      consent.publicationRevision,
      now.toISOString(),
      {
        publicListing: consent.publicListing,
        publicIndexing: consent.publicIndexing,
      }
    )
  publishDiscoveryConsentChanged(publicationConsent)
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
      publicTypeIndexUrl = await input.managers.publicTypeIndexManager.ensurePublicTypeIndex(
        input.podRoot,
        input.ownerWebId,
        publicationConsent.publicationRevision ?? 0
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
      ...(typeof publicationConsent.publicationRevision === 'number'
        ? { publicationRevision: publicationConsent.publicationRevision }
        : {}),
      publishedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MANIFEST_TTL_MS).toISOString(),
      ...(profile?.displayName ? { displayName: profile.displayName } : {}),
      ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      ...(publicTypeIndexUrl ? { publicTypeIndexUrl } : {}),
      ...(input.basicProfileOnly && publicationConsent.publicIndexing && previousManifest?.publicInterests
        ? { publicInterests: previousManifest.publicInterests }
        : {}),
      ...(input.basicProfileOnly && publicationConsent.publicIndexing && previousManifest?.capabilities
        ? { capabilities: previousManifest.capabilities }
        : {}),
      ...(input.basicProfileOnly && publicationConsent.publicIndexing && previousManifest?.inboxUrl
        ? { inboxUrl: previousManifest.inboxUrl }
        : {}),
      ...(!input.basicProfileOnly && publicationConsent.publicIndexing && selectedPublicInterests.length > 0
        ? { publicInterests: selectedPublicInterests }
        : {}),
      ...(!input.basicProfileOnly && publicationConsent.publicIndexing
        ? {
            capabilities: ['relationship-requests'],
            inboxUrl: `${input.podRoot.replace(/\/$/, '')}/social/inbox/`,
          }
        : {}),
    })
  } catch {
    const latestConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    const superseded = await reconcileSupersededPublication(
      input,
      publicationConsent,
      latestConsent,
      [publicTypeIndexUrl, previousManifest?.publicTypeIndexUrl],
      selectedPublicInterests
    )
    if (superseded) return superseded
    const rollbackPatch: Partial<Pick<DiscoveryConsent, 'publicListing' | 'publicIndexing'>> = {}
    const rollbackExpected: typeof rollbackPatch = {}
    if (publicationConsent.publicListing && !previousConsent.publicListing) {
      rollbackPatch.publicListing = false
      rollbackExpected.publicListing = true
    }
    if (publicationConsent.publicIndexing && !previousConsent.publicIndexing) {
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
  const afterManifestSuperseded = await reconcileSupersededPublication(
    input,
    publicationConsent,
    afterManifestConsent,
    [publicTypeIndexUrl, previousManifest?.publicTypeIndexUrl],
    selectedPublicInterests
  )
  if (afterManifestSuperseded) return afterManifestSuperseded
  try {
    if (publicTypeIndexUrl) {
      await input.managers.publicTypeIndexManager.ensureDiscoveryManifestRegistration(
        input.podRoot,
        publicTypeIndexUrl,
        manifestUrl,
        publicationConsent.publicationRevision
      )
    }
    if (
      previousManifest?.publicTypeIndexUrl &&
      previousManifest.publicTypeIndexUrl !== publicTypeIndexUrl
    ) {
      await input.managers.publicTypeIndexManager.removeDiscoveryManifestRegistration(
        input.podRoot,
        previousManifest.publicTypeIndexUrl,
        publicationConsent.publicationRevision ?? 0
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
  const afterTypeIndexSuperseded = await reconcileSupersededPublication(
    input,
    publicationConsent,
    afterTypeIndexConsent,
    [publicTypeIndexUrl, previousManifest?.publicTypeIndexUrl],
    selectedPublicInterests
  )
  if (afterTypeIndexSuperseded) return afterTypeIndexSuperseded
  const listed = await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
  return { consent: publicationConsent, listed, selectedPublicInterests }
}

async function reconcileSupersededPublication(
  input: UpdateDiscoveryPreferencesInput,
  reservedConsent: DiscoveryConsent,
  latestConsent: DiscoveryConsent,
  typeIndexUrls: Array<string | null | undefined>,
  selectedPublicInterests: string[]
): Promise<DiscoveryPreferencesResult | null> {
  if (latestConsent.publicationRevision === reservedConsent.publicationRevision) return null
  const optOut = await repairConcurrentFullOptOut(input, latestConsent, typeIndexUrls)
  if (optOut) return optOut
  const listed = await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
  return { consent: latestConsent, listed, selectedPublicInterests }
}

async function repairConcurrentFullOptOut(
  input: UpdateDiscoveryPreferencesInput,
  consent: DiscoveryConsent,
  typeIndexUrls: Array<string | null | undefined>
): Promise<DiscoveryPreferencesResult | null> {
  if (consent.publicListing || consent.publicIndexing) return null
  await suppressDirectoryProjection(
    input.provisionerUrl,
    input.authFetch,
    consent.publicationRevision ?? 0
  )
  let cleanupFailed = false
  for (const publicTypeIndexUrl of new Set(typeIndexUrls.filter(isString))) {
    try {
      const removed = await input.managers.publicTypeIndexManager.removeDiscoveryManifestRegistration(
        input.podRoot,
        publicTypeIndexUrl,
        consent.publicationRevision ?? 0
      )
      if (!removed) cleanupFailed = true
    } catch {
      cleanupFailed = true
    }
  }
  try {
    const removed = await input.managers.discoveryManifestManager.removeManifestIfUnchanged(
      input.podRoot,
      consent.publicationRevision ?? 0
    )
    if (!removed) cleanupFailed = true
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

function isNewerPublicActivation(baseline: DiscoveryConsent, candidate: DiscoveryConsent): boolean {
  return (
    (candidate.publicationRevision ?? 0) > (baseline.publicationRevision ?? 0) &&
    (candidate.publicListing || candidate.publicIndexing)
  )
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
  authFetch: typeof globalThis.fetch,
  expectedPublicationRevision: number
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
      headers: {
        accept: 'application/json',
        'x-nodezero-publication-revision': String(expectedPublicationRevision),
      },
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
