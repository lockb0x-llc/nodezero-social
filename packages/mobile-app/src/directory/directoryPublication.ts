import type { DiscoveryConsent, DiscoveryManifest } from '@nodezero/solid-pod-sync'
import {
  DiscoveryPreferencesError,
  refreshDirectoryProjection,
  suppressDirectoryProjection,
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
    removeManifestIfUnchanged: (
      podRoot: string,
      maximumPublicationRevision: number
    ) => Promise<boolean>
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
const MAX_RECONCILIATION_ATTEMPTS = 2
const publicationQueue = new Map<string, Promise<DirectoryPublicationOutcome>>()
const maintenanceQueue = new Map<string, Promise<DirectoryPublicationOutcome>>()

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
  const existing = maintenanceQueue.get(input.ownerWebId)
  if (existing) return existing
  const maintenance = enqueue(input.ownerWebId, () => maintainOnce(input)).finally(() => {
    if (maintenanceQueue.get(input.ownerWebId) === maintenance) {
      maintenanceQueue.delete(input.ownerWebId)
    }
  })
  maintenanceQueue.set(input.ownerWebId, maintenance)
  return maintenance
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
  input: DirectoryPublicationInput,
  reconciliationAttempt = 0
): Promise<DirectoryPublicationOutcome> {
  const consent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
  if (!input.available) {
    return retryDirectoryProjection({
      available: false,
      intendedListing: false,
      provisionerUrl: input.provisionerUrl,
      authFetch: input.authFetch,
    })
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
    return repairExistingUnlisting(input, consent, reconciliationAttempt)
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
    typeof consent.publicationRevision !== 'number' ||
    manifest.displayName !== (profile?.displayName || undefined) ||
    manifest.avatarUrl !== (profile?.avatarUrl || undefined) ||
    manifest.publicTypeIndexUrl !== publicTypeIndexUrl ||
    manifest.publicationRevision !== consent.publicationRevision ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now.getTime() + RENEWAL_WINDOW_MS
  if (!stale) {
    return syncExistingListing(input, reconciliationAttempt)
  }
  return renewExistingListing(
    input,
    profile,
    publicTypeIndexUrl,
    manifest ?? undefined,
    reconciliationAttempt
  )
}

async function repairExistingUnlisting(
  input: DirectoryPublicationInput,
  observedConsent: DiscoveryConsent,
  reconciliationAttempt: number
): Promise<DirectoryPublicationOutcome> {
  try {
    await suppressDirectoryProjection(
      input.provisionerUrl,
      input.authFetch,
      observedConsent.publicationRevision ?? 0
    )
  } catch (error) {
    return pendingSync(error, false)
  }
  let latestConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
  if (latestConsent.publicListing || latestConsent.publicIndexing) {
    return reconcileLatestConsent(input, latestConsent, reconciliationAttempt)
  }
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
    latestConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    if (latestConsent.publicListing || latestConsent.publicIndexing) {
      return reconcileLatestConsent(input, latestConsent, reconciliationAttempt)
    }
    const publicTypeIndexUrl =
      manifestPublicTypeIndexUrl ??
      (await input.managers.publicTypeIndexManager.discoverPublicTypeIndex(input.ownerWebId))
    if (publicTypeIndexUrl) {
      const removed = await input.managers.publicTypeIndexManager.removeDiscoveryManifestRegistration(
        input.podRoot,
        publicTypeIndexUrl,
        latestConsent.publicationRevision ?? observedConsent.publicationRevision ?? 0
      )
      if (!removed) return reconcileLatestConsent(input, latestConsent, reconciliationAttempt)
    }
  } catch (error) {
    cleanupError ??= error
  }
  try {
    latestConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    if (latestConsent.publicListing || latestConsent.publicIndexing) {
      return reconcileLatestConsent(input, latestConsent, reconciliationAttempt)
    }
    const maximumPublicationRevision =
      latestConsent.publicationRevision ?? observedConsent.publicationRevision ?? 0
    const removed = await input.managers.discoveryManifestManager.removeManifestIfUnchanged(
      input.podRoot,
      maximumPublicationRevision
    )
    if (!removed) {
      latestConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
      return reconcileLatestConsent(input, latestConsent, reconciliationAttempt)
    }
  } catch (error) {
    cleanupError ??= error
  }
  latestConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
  if (latestConsent.publicListing || latestConsent.publicIndexing) {
    return reconcileLatestConsent(input, latestConsent, reconciliationAttempt)
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

function reconcileLatestConsent(
  input: DirectoryPublicationInput,
  consent: DiscoveryConsent,
  reconciliationAttempt: number
): Promise<DirectoryPublicationOutcome> {
  if (reconciliationAttempt >= MAX_RECONCILIATION_ATTEMPTS) {
    return Promise.resolve(
      pendingSync(
        new Error('Directory publication changed concurrently; retry synchronization.'),
        consent.publicListing
      )
    )
  }
  return maintainOnce(input, reconciliationAttempt + 1)
}

async function renewExistingListing(
  input: DirectoryPublicationInput,
  _profile: Awaited<ReturnType<PublicationManagers['profileManager']['readProfile']>>,
  _knownPublicTypeIndexUrl?: string,
  _previousManifest?: DiscoveryManifest,
  reconciliationAttempt = 0
): Promise<DirectoryPublicationOutcome> {
  try {
    const observedConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    if (!observedConsent.publicListing) {
      return repairExistingUnlisting(input, observedConsent, reconciliationAttempt)
    }
    const consent = await input.managers.discoveryConsentManager.reservePublicationRevision(
      input.podRoot,
      observedConsent.publicationRevision,
      (input.now ?? new Date()).toISOString()
    )
    const now = input.now ?? new Date()
    const [profile, publicTypeIndexUrl, previousManifest] = await Promise.all([
      input.managers.profileManager.readProfile(input.ownerWebId),
      input.managers.publicTypeIndexManager.discoverPublicTypeIndex(input.ownerWebId),
      input.managers.discoveryManifestManager.readManifest(input.podRoot),
    ])
    if (!publicTypeIndexUrl) {
      return pendingSync(
        new Error('Your public Type Index is unavailable for Directory publication.'),
        true
      )
    }
    await input.managers.discoveryManifestManager.writeManifest(input.podRoot, {
      version: 1,
      webId: input.ownerWebId,
      ...(typeof consent.publicationRevision === 'number'
        ? { publicationRevision: consent.publicationRevision }
        : {}),
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
    if (
      !latestConsent.publicListing ||
      latestConsent.publicationRevision !== consent.publicationRevision
    ) {
      if (latestConsent.publicListing) {
        return reconcileLatestConsent(input, latestConsent, reconciliationAttempt)
      }
      return repairExistingUnlisting(input, latestConsent, reconciliationAttempt)
    }
    if (
      previousManifest?.publicTypeIndexUrl &&
      previousManifest.publicTypeIndexUrl !== publicTypeIndexUrl
    ) {
      await input.managers.publicTypeIndexManager.removeDiscoveryManifestRegistration(
        input.podRoot,
        previousManifest.publicTypeIndexUrl,
        consent.publicationRevision ?? 0
      )
    }
    return syncExistingListing(input, reconciliationAttempt)
  } catch (error) {
    return pendingSync(error, true)
  }
}

async function syncExistingListing(
  input: DirectoryPublicationInput,
  reconciliationAttempt = 0
): Promise<DirectoryPublicationOutcome> {
  try {
    const consent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    if (!consent.publicListing) {
      return repairExistingUnlisting(input, consent, reconciliationAttempt)
    }
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
      `${input.podRoot.replace(/\/$/, '')}/public/discovery/manifest`,
      consent.publicationRevision
    )
    const latestConsent = await input.managers.discoveryConsentManager.readConsent(input.podRoot)
    if (!latestConsent.publicListing) {
      return repairExistingUnlisting(input, latestConsent, reconciliationAttempt)
    }
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
      const reconciled = await maintainOnce(input, 1)
      if (
        (listed && reconciled.status === 'published') ||
        (!listed && reconciled.status === 'unpublished')
      ) {
        return reconciled
      }
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
