import type { DiscoveryConsent, DiscoveryManifest } from '@nodezero/solid-pod-sync'
import {
  DiscoveryPreferencesError,
  refreshDirectoryProjection,
  updateDiscoveryPreferences,
  type UpdateDiscoveryPreferencesInput,
} from './discoveryPreferences'
import { readDirectoryFeatureAvailability } from './directoryFeatureClient'

export type DirectoryPublicationOutcome =
  | { status: 'published'; listed: true }
  | { status: 'unpublished'; listed: false }
  | { status: 'pending-sync'; intendedListing: boolean; message: string }
  | { status: 'unchanged'; listed: boolean }

type PublicationManagers = UpdateDiscoveryPreferencesInput['managers'] & {
  discoveryConsentManager: UpdateDiscoveryPreferencesInput['managers']['discoveryConsentManager']
  discoveryManifestManager: UpdateDiscoveryPreferencesInput['managers']['discoveryManifestManager'] & {
    readManifest: (podRoot: string) => Promise<DiscoveryManifest | null>
  }
}

export interface DirectoryPublicationInput {
  available: boolean
  podRoot: string
  ownerWebId: string
  provisionerUrl: string
  authFetch: typeof globalThis.fetch
  managers: PublicationManagers
  now?: Date
}

const RENEWAL_WINDOW_MS = 48 * 60 * 60_000
const publicationQueue = new Map<string, Promise<DirectoryPublicationOutcome>>()

export async function publishBasicDirectoryProfile(
  input: DirectoryPublicationInput
): Promise<DirectoryPublicationOutcome> {
  assertAvailable(input.available)
  return enqueue(input.ownerWebId, async () => {
    const features = await readDirectoryFeatureAvailability(input.provisionerUrl, input.authFetch)
    assertAvailable(features.directory)
    const consent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    return applyListing(input, consent, true)
  })
}

export async function unpublishDirectoryProfile(
  input: DirectoryPublicationInput
): Promise<DirectoryPublicationOutcome> {
  return enqueue(input.ownerWebId, async () => {
    const consent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    return applyListing(input, consent, false)
  })
}

export async function retryDirectoryProjection(
  input: Pick<DirectoryPublicationInput, 'available' | 'provisionerUrl' | 'authFetch'> & {
    intendedListing: boolean
  }
): Promise<DirectoryPublicationOutcome> {
  if (input.intendedListing) assertAvailable(input.available)
  try {
    const listed = await refreshDirectoryProjection(input.provisionerUrl, input.authFetch)
    if (listed !== input.intendedListing) {
      return {
        status: 'pending-sync',
        intendedListing: input.intendedListing,
        message: 'Directory projection does not yet match your publication setting.',
      }
    }
    return listed ? { status: 'published', listed: true } : { status: 'unpublished', listed: false }
  } catch (error) {
    return pendingSync(error, input.intendedListing)
  }
}

export function maintainDirectoryPublication(
  input: DirectoryPublicationInput
): Promise<DirectoryPublicationOutcome> {
  return enqueue(input.ownerWebId, () => maintainOnce(input))
}

function enqueue(
  webId: string,
  operation: () => Promise<DirectoryPublicationOutcome>
): Promise<DirectoryPublicationOutcome> {
  const previous = publicationQueue.get(webId)
  const queued = (previous ? previous.catch(() => undefined).then(operation) : operation()).finally(
    () => {
      if (publicationQueue.get(webId) === queued) publicationQueue.delete(webId)
    }
  )
  publicationQueue.set(webId, queued)
  return queued
}

async function maintainOnce(
  input: DirectoryPublicationInput
): Promise<DirectoryPublicationOutcome> {
  const consent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
  if (!input.available) {
    if (consent.publicIndexing) {
      return retryDirectoryProjection({
        available: false,
        intendedListing: false,
        provisionerUrl: input.provisionerUrl,
        authFetch: input.authFetch,
      })
    }
    return repairExistingUnlisting(input)
  }
  if (!consent.publicListing) {
    if (consent.publicIndexing) {
      return retryDirectoryProjection({
        available: true,
        intendedListing: false,
        provisionerUrl: input.provisionerUrl,
        authFetch: input.authFetch,
      })
    }
    return repairExistingUnlisting(input)
  }
  const [manifest, profile, publicTypeIndexUrl] = await Promise.all([
    input.managers.discoveryManifestManager.readManifest(input.podRoot),
    input.managers.profileManager.readProfile(input.ownerWebId),
    input.managers.publicTypeIndexManager.discoverPublicTypeIndex(input.ownerWebId),
  ])
  if (!publicTypeIndexUrl) {
    return pendingSync(
      new Error('Your public Type Index is unavailable for Directory publication.'),
      true
    )
  }
  const now = input.now ?? new Date()
  const expiresAt = manifest ? Date.parse(manifest.expiresAt) : Number.NaN
  const stale =
    !manifest ||
    manifest.displayName !== (profile?.displayName || undefined) ||
    manifest.avatarUrl !== (profile?.avatarUrl || undefined) ||
    manifest.publicTypeIndexUrl !== publicTypeIndexUrl ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now.getTime() + RENEWAL_WINDOW_MS
  if (!stale) {
    return syncExistingListing(input)
  }
  return renewExistingListing(input, profile, publicTypeIndexUrl, manifest ?? undefined)
}

async function repairExistingUnlisting(
  input: DirectoryPublicationInput
): Promise<DirectoryPublicationOutcome> {
  let cleanupError: unknown = null
  let manifestPublicTypeIndexUrl: string | null = null
  try {
    manifestPublicTypeIndexUrl =
      (await input.managers.discoveryManifestManager.readManifest(input.podRoot))
        ?.publicTypeIndexUrl ?? null
  } catch (error) {
    cleanupError = error
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
  } catch (error) {
    cleanupError ??= error
  }
  try {
    await input.managers.discoveryManifestManager.removeManifest(input.podRoot)
  } catch (error) {
    cleanupError ??= error
  }
  try {
    const projection = await retryDirectoryProjection({
      available: true,
      intendedListing: false,
      provisionerUrl: input.provisionerUrl,
      authFetch: input.authFetch,
    })
    return cleanupError ? pendingSync(cleanupError, false) : projection
  } catch (error) {
    return pendingSync(cleanupError ?? error, false)
  }
}

async function renewExistingListing(
  input: DirectoryPublicationInput,
  profile: Awaited<ReturnType<PublicationManagers['profileManager']['readProfile']>>,
  knownPublicTypeIndexUrl?: string,
  previousManifest?: DiscoveryManifest
): Promise<DirectoryPublicationOutcome> {
  try {
    const consent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    if (!consent.publicListing) return repairExistingUnlisting(input)
    const now = input.now ?? new Date()
    const publicTypeIndexUrl =
      knownPublicTypeIndexUrl ??
      (await input.managers.publicTypeIndexManager.discoverPublicTypeIndex(input.ownerWebId))
    if (!publicTypeIndexUrl) {
      return pendingSync(
        new Error('Your public Type Index is unavailable for Directory publication.'),
        true
      )
    }
    await input.managers.discoveryManifestManager.writeManifest(input.podRoot, {
      version: 1,
      webId: input.ownerWebId,
      publishedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
      ...(profile?.displayName ? { displayName: profile.displayName } : {}),
      ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      publicTypeIndexUrl,
      ...(consent.publicIndexing && previousManifest?.publicInterests
        ? { publicInterests: previousManifest.publicInterests }
        : {}),
      ...(consent.publicIndexing && previousManifest?.capabilities
        ? { capabilities: previousManifest.capabilities }
        : {}),
      ...(consent.publicIndexing && previousManifest?.inboxUrl
        ? { inboxUrl: previousManifest.inboxUrl }
        : {}),
    })
    const latestConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    if (!latestConsent.publicListing) return repairExistingUnlisting(input)
    if (
      previousManifest?.publicTypeIndexUrl &&
      previousManifest.publicTypeIndexUrl !== publicTypeIndexUrl
    ) {
      await input.managers.publicTypeIndexManager.removeDiscoveryManifestRegistration(
        input.podRoot,
        previousManifest.publicTypeIndexUrl
      )
    }
    return syncExistingListing(input)
  } catch (error) {
    return pendingSync(error, true)
  }
}

async function syncExistingListing(
  input: DirectoryPublicationInput
): Promise<DirectoryPublicationOutcome> {
  try {
    const consent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    if (!consent.publicListing) return repairExistingUnlisting(input)
    const publicTypeIndexUrl = await input.managers.publicTypeIndexManager.discoverPublicTypeIndex(
      input.ownerWebId
    )
    if (!publicTypeIndexUrl) {
      return pendingSync(
        new Error('Your public Type Index is unavailable for Directory publication.'),
        true
      )
    }
    await input.managers.publicTypeIndexManager.ensureDiscoveryManifestRegistration(
      input.podRoot,
      publicTypeIndexUrl,
      `${input.podRoot.replace(/\/$/, '')}/public/discovery/manifest`
    )
    const latestConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    if (!latestConsent.publicListing) return repairExistingUnlisting(input)
    return retryDirectoryProjection({
      available: true,
      intendedListing: true,
      provisionerUrl: input.provisionerUrl,
      authFetch: input.authFetch,
    })
  } catch (error) {
    return pendingSync(error, true)
  }
}

async function applyListing(
  input: DirectoryPublicationInput,
  consent: DiscoveryConsent,
  listed: boolean
): Promise<DirectoryPublicationOutcome> {
  try {
    const result = await updateDiscoveryPreferences({
      podRoot: input.podRoot,
      ownerWebId: input.ownerWebId,
      preferences: {
        publicListing: listed,
        publicIndexing: consent.publicIndexing,
        nearbyPresence: consent.nearbyPresence,
        localBroadcasts: consent.localBroadcasts,
        selectedPublicInterests: [],
      },
      baselineConsent: {
        publicListing: consent.publicListing,
        publicIndexing: consent.publicIndexing,
        nearbyPresence: consent.nearbyPresence,
        localBroadcasts: consent.localBroadcasts,
      },
      provisionerUrl: input.provisionerUrl,
      authFetch: input.authFetch,
      managers: input.managers,
      requirePublicTypeIndex: listed,
      basicProfileOnly: listed,
      preserveIndependentIndexingArtifacts: !listed,
      ...(input.now ? { now: input.now } : {}),
    })
    if (result.listed !== listed) {
      return {
        status: 'pending-sync',
        intendedListing: listed,
        message: 'Directory projection does not yet match your publication setting.',
      }
    }
    return result.listed
      ? { status: 'published', listed: true }
      : { status: 'unpublished', listed: false }
  } catch (error) {
    if (
      error instanceof DiscoveryPreferencesError &&
      (error.code.startsWith('directory_refresh_') ||
        error.code === 'manifest_cleanup_failed' ||
        error.code === 'type_index_sync_failed')
    ) {
      return pendingSync(error, listed)
    }
    throw error
  }
}

function pendingSync(error: unknown, intendedListing: boolean): DirectoryPublicationOutcome {
  return {
    status: 'pending-sync',
    intendedListing,
    message: error instanceof Error ? error.message : 'Directory synchronization is pending.',
  }
}

function assertAvailable(available: boolean): void {
  if (!available) {
    throw new DiscoveryPreferencesError(
      'Community Directory is not available for this account.',
      'directory_unavailable'
    )
  }
}
