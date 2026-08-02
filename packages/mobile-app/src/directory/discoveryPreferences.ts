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
      'writeManifest' | 'removeManifest'
    >
    publicTypeIndexManager: Pick<
      PublicTypeIndexManager,
      'discoverPublicTypeIndex' | 'ensureDiscoveryManifestRegistration'
    >
    profileManager: Pick<ProfileManager, 'readProfile'>
    profilePreferencesManager: Pick<ProfilePreferencesManager, 'readPreferences'>
  }
  now?: Date
}

export interface DiscoveryPreferencesResult {
  consent: DiscoveryConsent
  listed: boolean
  selectedPublicInterests: string[]
}

export class DiscoveryPreferencesError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'DiscoveryPreferencesError'
  }
}

const MANIFEST_TTL_MS = 7 * 24 * 60 * 60_000

export async function updateDiscoveryPreferences(
  input: UpdateDiscoveryPreferencesInput
): Promise<DiscoveryPreferencesResult> {
  const [privatePreferences, previousConsent] = await Promise.all([
    input.managers.profilePreferencesManager.readPreferences(input.podRoot),
    input.managers.discoveryConsentManager.readConsent(input.podRoot),
  ])
  const selectedPublicInterests = validateSelectedInterests(
    privatePreferences?.interests ?? [],
    input.preferences.selectedPublicInterests
  )
  const now = input.now ?? new Date()
  const mergedPreferences = mergeConsentChanges(
    previousConsent,
    input.baselineConsent,
    input.preferences
  )
  const consent = await input.managers.discoveryConsentManager.updateConsent(
    input.podRoot,
    {
      publicListing: mergedPreferences.publicListing,
      publicIndexing: mergedPreferences.publicIndexing,
      nearbyPresence: mergedPreferences.nearbyPresence,
      localBroadcasts: mergedPreferences.localBroadcasts,
    },
    now.toISOString()
  )
  publishDiscoveryConsentChanged(consent)
  const publish = consent.publicListing || consent.publicIndexing
  if (!publish) {
    let manifestCleanupFailed = false
    try {
      await input.managers.discoveryManifestManager.removeManifest(input.podRoot)
    } catch {
      manifestCleanupFailed = true
    }
    const listed = await refreshProjection(input.provisionerUrl, input.authFetch)
    if (manifestCleanupFailed) {
      throw new DiscoveryPreferencesError(
        'Discovery is disabled and the directory projection was removed, but public manifest cleanup failed.',
        'manifest_cleanup_failed'
      )
    }
    return { consent, listed, selectedPublicInterests }
  }

  const profile = await input.managers.profileManager.readProfile(input.ownerWebId)
  const manifestUrl = `${input.podRoot.replace(/\/$/, '')}/public/discovery/manifest`
  try {
    await input.managers.discoveryManifestManager.removeManifest(input.podRoot)
    await input.managers.discoveryManifestManager.writeManifest(input.podRoot, {
      version: 1,
      webId: input.ownerWebId,
      publishedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MANIFEST_TTL_MS).toISOString(),
      ...(profile?.displayName ? { displayName: profile.displayName } : {}),
      ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      ...(consent.publicIndexing && selectedPublicInterests.length > 0
        ? { publicInterests: selectedPublicInterests }
        : {}),
      ...(consent.publicIndexing
        ? {
            capabilities: ['relationship-requests'],
            inboxUrl: `${input.podRoot.replace(/\/$/, '')}/social/inbox/`,
          }
        : {}),
    })
  } catch {
    const conservativeConsent = await input.managers.discoveryConsentManager.updateConsent(
      input.podRoot,
      {
        publicListing: consent.publicListing && previousConsent.publicListing,
        publicIndexing: consent.publicIndexing && previousConsent.publicIndexing,
      },
      new Date().toISOString()
    )
    publishDiscoveryConsentChanged(conservativeConsent)
    await refreshProjection(input.provisionerUrl, input.authFetch)
    throw new DiscoveryPreferencesError(
      'Public discovery changes were applied conservatively, but manifest publication failed.',
      'manifest_publish_failed'
    )
  }
  const publicTypeIndexUrl = await input.managers.publicTypeIndexManager
    .discoverPublicTypeIndex(input.ownerWebId)
  if (publicTypeIndexUrl) {
    await input.managers.publicTypeIndexManager.ensureDiscoveryManifestRegistration(
      input.podRoot,
      publicTypeIndexUrl,
      manifestUrl
    )
  }
  const listed = await refreshProjection(input.provisionerUrl, input.authFetch)
  return { consent, listed, selectedPublicInterests }
}

function mergeConsentChanges(
  current: DiscoveryConsent,
  baseline: UpdateDiscoveryPreferencesInput['baselineConsent'],
  desired: DiscoveryPreferences
): UpdateDiscoveryPreferencesInput['baselineConsent'] {
  return {
    publicListing: desired.publicListing === baseline.publicListing
      ? current.publicListing
      : desired.publicListing,
    publicIndexing: desired.publicIndexing === baseline.publicIndexing
      ? current.publicIndexing
      : desired.publicIndexing,
    nearbyPresence: desired.nearbyPresence === baseline.nearbyPresence
      ? current.nearbyPresence
      : desired.nearbyPresence,
    localBroadcasts: desired.localBroadcasts === baseline.localBroadcasts
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

async function refreshProjection(
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
  const response = await authFetch(`${baseUrl}/v1/community-directory/refresh`, {
    method: 'POST',
    headers: { accept: 'application/json' },
  })
  const payload = await response.json().catch(() => ({})) as {
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
  return payload.listed === true
}
