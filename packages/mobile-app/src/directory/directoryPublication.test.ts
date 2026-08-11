import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DiscoveryConsent, DiscoveryManifest } from '@nodezero/solid-pod-sync'
import {
  maintainDirectoryPublication,
  publishBasicDirectoryProfile,
  retryDirectoryProjection,
  unpublishDirectoryProfile,
  type DirectoryPublicationInput,
} from './directoryPublication'

const ownerWebId = 'https://alice.example/profile/card#me'
const podRoot = 'https://alice.example/'
const now = new Date('2026-08-05T12:00:00.000Z')

function setup(
  overrides: {
    consent?: Partial<DiscoveryConsent>
    manifest?: DiscoveryManifest | null
    refreshStatus?: number
    refreshPayload?: object
    refreshThrows?: boolean
    featureAvailable?: boolean
  } = {}
): { input: DirectoryPublicationInput; calls: string[]; manifests: DiscoveryManifest[] } {
  const calls: string[] = []
  const manifests: DiscoveryManifest[] = []
  let consent: DiscoveryConsent = {
    version: 1,
    revision: 0,
    ownerWebId,
    publicListing: false,
    publicIndexing: false,
    nearbyPresence: false,
    inboundContactRequests: false,
    localBroadcasts: false,
    updatedAt: now.toISOString(),
    ...overrides.consent,
  }
  return {
    calls,
    manifests,
    input: {
      available: true,
      podRoot,
      ownerWebId,
      provisionerUrl: 'https://api.nodezero.example',
      now,
      authFetch: async (request) => {
        const url = String(request)
        if (url.endsWith('/v1/milestone-q/features')) {
          return new Response(
            JSON.stringify({
              version: 1,
              features: {
                directory: overrides.featureAvailable ?? true,
                peerProfile: false,
                relationship: false,
                transport: false,
              },
            })
          )
        }
        if (url.endsWith('/v1/community-directory/suppress')) {
          return new Response(JSON.stringify({ listed: false }))
        }
        if (overrides.refreshThrows) throw new Error('network unavailable')
        return new Response(
          JSON.stringify(overrides.refreshPayload ?? { listed: consent.publicListing }),
          { status: overrides.refreshStatus ?? 200 }
        )
      },
      managers: {
        discoveryConsentManager: {
          readConsent: async () => consent,
          updateConsent: async (_root, patch, updatedAt) => {
            calls.push(`consent:${String(patch.publicListing)}:${String(patch.publicIndexing)}`)
            const publicationChanged =
              (patch.publicListing !== undefined &&
                patch.publicListing !== consent.publicListing) ||
              (patch.publicIndexing !== undefined &&
                patch.publicIndexing !== consent.publicIndexing)
            consent = {
              ...consent,
              ...patch,
              revision: (consent.revision ?? 0) + 1,
              ...(publicationChanged
                ? {
                    publicationRevision: (consent.publicationRevision ?? 0) + 1,
                    publicationUpdatedAt: updatedAt ?? now.toISOString(),
                  }
                : {}),
              updatedAt: updatedAt ?? now.toISOString(),
            }
            return consent
          },
          reservePublicationRevision: async (_root, expected, updatedAt) => {
            if (expected !== undefined && (consent.publicationRevision ?? 0) !== expected) {
              throw new Error('Discovery publication changed concurrently; retry the operation.')
            }
            consent = {
              ...consent,
              revision: (consent.revision ?? 0) + 1,
              publicationRevision: (consent.publicationRevision ?? 0) + 1,
              publicationUpdatedAt: updatedAt,
              updatedAt: updatedAt ?? now.toISOString(),
            }
            return consent
          },
        },
        discoveryManifestManager: {
          readManifest: async () => overrides.manifest ?? null,
          removeManifestIfUnchanged: async () => {
            calls.push('manifest:remove')
            return true
          },
          writeManifest: async (_root, manifest) => {
            calls.push('manifest:write')
            manifests.push(manifest)
            return `${podRoot}public/discovery/manifest`
          },
        },
        publicTypeIndexManager: {
          discoverPublicTypeIndex: async () => `${podRoot}settings/publicTypeIndex`,
          ensurePublicTypeIndex: async () => {
            calls.push('type-index:ensure')
            return `${podRoot}public/discovery/type-index`
          },
          ensureDiscoveryManifestRegistration: async () => {
            calls.push('type-index:register')
            return `${podRoot}settings/publicTypeIndex#manifest`
          },
          removeDiscoveryManifestRegistration: async () => {
            calls.push('type-index:remove')
            return true
          },
        },
        profileManager: {
          readProfile: async () => ({
            displayName: 'Alice',
            avatarUrl: 'https://alice.example/avatar.png',
            bio: 'Private biography',
            interests: ['Private interest'],
            isNsfw: false,
          }),
        },
        profilePreferencesManager: {
          readPreferences: async () => ({ interests: ['Private interest'], isNsfw: false }),
        },
      },
    },
  }
}

void test('publishes only the basic persisted profile fields', async () => {
  const { input, calls, manifests } = setup()
  assert.deepEqual(await publishBasicDirectoryProfile(input), { status: 'published', listed: true })
  assert.deepEqual(calls, ['consent:true:undefined', 'manifest:write', 'type-index:register'])
  assert.equal(manifests[0]?.displayName, 'Alice')
  assert.equal(manifests[0]?.avatarUrl, 'https://alice.example/avatar.png')
  assert.equal(manifests[0]?.publicInterests, undefined)
  assert.equal(manifests[0]?.capabilities, undefined)
  assert.equal(manifests[0]?.inboxUrl, undefined)
  assert.equal(JSON.stringify(manifests[0]).includes('Private biography'), false)
})

void test('provisions a public Type Index when publishing a fresh profile', async () => {
  const { input, calls, manifests } = setup()
  let pointerPublicationRevision: number | undefined
  input.managers.publicTypeIndexManager.discoverPublicTypeIndex = async () => null
  input.managers.publicTypeIndexManager.ensurePublicTypeIndex = async (
    _root,
    _webId,
    publicationRevision
  ) => {
    pointerPublicationRevision = publicationRevision
    calls.push('type-index:ensure')
    return `${podRoot}public/discovery/type-index`
  }
  const outcome = await publishBasicDirectoryProfile(input)
  assert.deepEqual(outcome, { status: 'published', listed: true })
  assert.equal(calls.includes('type-index:ensure'), true)
  assert.equal(pointerPublicationRevision, 2)
  assert.equal(manifests[0]?.publicTypeIndexUrl, `${podRoot}public/discovery/type-index`)
})

void test('maintenance self-migrates a generationless public listing', async () => {
  const manifest: DiscoveryManifest = {
    version: 1,
    webId: ownerWebId,
    displayName: 'Alice',
    avatarUrl: 'https://alice.example/avatar.png',
    publicTypeIndexUrl: `${podRoot}settings/publicTypeIndex`,
    publishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 4 * 24 * 60 * 60_000).toISOString(),
  }
  const { input, manifests } = setup({
    consent: { publicListing: true },
    manifest,
  })

  assert.deepEqual(await maintainDirectoryPublication(input), {
    status: 'published',
    listed: true,
  })
  assert.equal(manifests[0]?.publicationRevision, 1)
})

void test('reports pending synchronization when public Type Index provisioning fails', async () => {
  const { input } = setup()
  input.managers.publicTypeIndexManager.discoverPublicTypeIndex = async () => null
  input.managers.publicTypeIndexManager.ensurePublicTypeIndex = async () => {
    throw new Error('Pod write failed')
  }
  const outcome = await publishBasicDirectoryProfile(input)
  assert.equal(outcome.status, 'pending-sync')
})

void test('rejects unavailable users before any Pod write', async () => {
  const { input, calls } = setup()
  input.available = false
  await assert.rejects(publishBasicDirectoryProfile(input), /not available/)
  assert.deepEqual(calls, [])
})

void test('rechecks cohort availability before writing Pod publication state', async () => {
  const { input, calls } = setup({ featureAvailable: false })
  await assert.rejects(publishBasicDirectoryProfile(input), /not available/)
  assert.deepEqual(calls, [])
})

void test('allows unpublish after Directory cohort access is withdrawn', async () => {
  const { input } = setup({ consent: { publicListing: true } })
  input.available = false
  assert.deepEqual(await unpublishDirectoryProfile(input), {
    status: 'unpublished',
    listed: false,
  })
})

void test('maintenance preserves independent indexing-only consent', async () => {
  const { input, calls } = setup({
    consent: { publicListing: false, publicIndexing: true },
  })
  assert.deepEqual(await maintainDirectoryPublication(input), {
    status: 'unpublished',
    listed: false,
  })
  assert.equal(calls.includes('manifest:remove'), false)
  assert.equal(calls.includes('type-index:remove'), false)
  assert.equal(
    calls.some((call) => call.startsWith('consent:')),
    false
  )
})

void test('returns pending-sync when Pod intent is saved but projection refresh fails', async () => {
  const { input } = setup({ refreshStatus: 503 })
  const outcome = await publishBasicDirectoryProfile(input)
  assert.equal(outcome.status, 'pending-sync')
  if (outcome.status === 'pending-sync') assert.equal(outcome.intendedListing, true)
})

void test('unpublishes without enabling indexing', async () => {
  const { input, calls } = setup({ consent: { publicListing: true } })
  assert.deepEqual(await unpublishDirectoryProfile(input), { status: 'unpublished', listed: false })
  assert.equal(calls[0], 'consent:false:undefined')
  assert.equal(calls.includes('manifest:write'), false)
})

void test('unpublish preserves existing independent indexing consent and artifacts', async () => {
  const { input, calls } = setup({
    consent: { publicListing: true, publicIndexing: true },
  })
  assert.deepEqual(await unpublishDirectoryProfile(input), { status: 'unpublished', listed: false })
  assert.equal(calls[0], 'consent:false:undefined')
  assert.equal(calls.includes('manifest:remove'), false)
  assert.equal(calls.includes('type-index:remove'), false)
})

void test('first Directory publish preserves independently indexed manifest metadata', async () => {
  const existingManifest: DiscoveryManifest = {
    version: 1,
    webId: ownerWebId,
    publicTypeIndexUrl: `${podRoot}settings/publicTypeIndex`,
    publicInterests: ['public-interest'],
    capabilities: ['relationship-requests'],
    inboxUrl: `${podRoot}social/inbox/`,
    publishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 4 * 24 * 60 * 60_000).toISOString(),
  }
  const { input, manifests } = setup({
    consent: { publicIndexing: true },
    manifest: existingManifest,
  })
  assert.equal((await publishBasicDirectoryProfile(input)).status, 'published')
  assert.deepEqual(manifests[0]?.publicInterests, existingManifest.publicInterests)
  assert.deepEqual(manifests[0]?.capabilities, existingManifest.capabilities)
  assert.equal(manifests[0]?.inboxUrl, existingManifest.inboxUrl)
})

void test('maintenance retries stale public manifest cleanup after unpublish restart', async () => {
  const staleManifest: DiscoveryManifest = {
    version: 1,
    webId: ownerWebId,
    displayName: 'Alice',
    publishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 4 * 24 * 60 * 60_000).toISOString(),
  }
  const { input, calls } = setup({ manifest: staleManifest })
  const outcome = await maintainDirectoryPublication(input)
  assert.deepEqual(outcome, { status: 'unpublished', listed: false })
  assert.equal(calls.includes('manifest:remove'), true)
})

void test('maintenance preserves pending unpublish when manifest cleanup still fails', async () => {
  const staleManifest: DiscoveryManifest = {
    version: 1,
    webId: ownerWebId,
    displayName: 'Alice',
    publishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 4 * 24 * 60 * 60_000).toISOString(),
  }
  const { input } = setup({ manifest: staleManifest })
  input.managers.discoveryManifestManager.removeManifestIfUnchanged = async () => {
    throw new Error('delete unavailable')
  }
  const outcome = await maintainDirectoryPublication(input)
  assert.equal(outcome.status, 'pending-sync')
  if (outcome.status === 'pending-sync') assert.equal(outcome.intendedListing, false)
})

void test('renews only missing, changed, or near-expiry manifests', async () => {
  const currentManifest: DiscoveryManifest = {
    version: 1,
    webId: ownerWebId,
    publicationRevision: 0,
    displayName: 'Alice',
    avatarUrl: 'https://alice.example/avatar.png',
    publicTypeIndexUrl: `${podRoot}settings/publicTypeIndex`,
    publishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 4 * 24 * 60 * 60_000).toISOString(),
  }
  const current = setup({
    consent: { publicListing: true, publicationRevision: 0 },
    manifest: currentManifest,
  })
  assert.deepEqual(await maintainDirectoryPublication(current.input), {
    status: 'published',
    listed: true,
  })
  assert.deepEqual(current.calls, ['type-index:register'])

  const expiring = setup({
    consent: { publicListing: true, publicationRevision: 0 },
    manifest: {
      ...currentManifest,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
    },
  })
  assert.equal((await maintainDirectoryPublication(expiring.input)).status, 'published')
  assert.equal(expiring.calls.includes('manifest:write'), true)
})

void test('maintenance preserves independent indexing artifacts outside the Directory projection', async () => {
  const { input, manifests } = setup({
    consent: { publicListing: true, publicIndexing: true, publicationRevision: 0 },
    manifest: {
      version: 1,
      webId: ownerWebId,
      publicationRevision: 0,
      displayName: 'Alice',
      avatarUrl: 'https://alice.example/avatar.png',
      publicTypeIndexUrl: `${podRoot}settings/publicTypeIndex`,
      publicInterests: ['legacy-private-interest'],
      capabilities: ['relationship-requests'],
      inboxUrl: `${podRoot}social/inbox/`,
      publishedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 4 * 24 * 60 * 60_000).toISOString(),
    },
  })
  assert.equal((await maintainDirectoryPublication(input)).status, 'published')
  assert.equal(manifests.length, 0)
})

void test('renewal preserves independently indexed manifest metadata', async () => {
  const existingManifest: DiscoveryManifest = {
    version: 1,
    webId: ownerWebId,
    displayName: 'Alice',
    avatarUrl: 'https://alice.example/avatar.png',
    publicTypeIndexUrl: `${podRoot}settings/publicTypeIndex`,
    publicInterests: ['public-interest'],
    capabilities: ['relationship-requests'],
    inboxUrl: `${podRoot}social/inbox/`,
    publishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  }
  const { input, manifests } = setup({
    consent: { publicListing: true, publicIndexing: true },
    manifest: existingManifest,
  })
  assert.equal((await maintainDirectoryPublication(input)).status, 'published')
  assert.deepEqual(manifests[0]?.publicInterests, existingManifest.publicInterests)
  assert.deepEqual(manifests[0]?.capabilities, existingManifest.capabilities)
  assert.equal(manifests[0]?.inboxUrl, existingManifest.inboxUrl)
})

void test('maintenance rewrites a relocated Type Index pointer and removes the old registration', async () => {
  const oldTypeIndexUrl = `${podRoot}settings/oldPublicTypeIndex`
  const { input, calls, manifests } = setup({
    consent: { publicListing: true },
    manifest: {
      version: 1,
      webId: ownerWebId,
      displayName: 'Alice',
      avatarUrl: 'https://alice.example/avatar.png',
      publicTypeIndexUrl: oldTypeIndexUrl,
      publishedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 4 * 24 * 60 * 60_000).toISOString(),
    },
  })
  assert.equal((await maintainDirectoryPublication(input)).status, 'published')
  assert.equal(manifests[0]?.publicTypeIndexUrl, `${podRoot}settings/publicTypeIndex`)
  assert.equal(calls.includes('type-index:remove'), true)
})

void test('preserves unpublish intent while projection retry remains unavailable', async () => {
  const outcome = await retryDirectoryProjection({
    available: true,
    intendedListing: false,
    provisionerUrl: 'https://api.nodezero.example',
    authFetch: async () => new Response('{}', { status: 503 }),
  })
  assert.equal(outcome.status, 'pending-sync')
  if (outcome.status === 'pending-sync') assert.equal(outcome.intendedListing, false)
})

void test('treats a projection network failure as pending synchronization', async () => {
  const { input } = setup({ refreshThrows: true })
  const outcome = await publishBasicDirectoryProfile(input)
  assert.equal(outcome.status, 'pending-sync')
})

void test('rejects malformed successful projection responses', async () => {
  const { input } = setup({ refreshPayload: {} })
  const outcome = await publishBasicDirectoryProfile(input)
  assert.equal(outcome.status, 'pending-sync')
})

void test('serializes renewal and unpublish so opt-out wins', async () => {
  const expiringManifest: DiscoveryManifest = {
    version: 1,
    webId: ownerWebId,
    displayName: 'Alice',
    avatarUrl: 'https://alice.example/avatar.png',
    publicTypeIndexUrl: `${podRoot}settings/publicTypeIndex`,
    publishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  }
  const { input, calls } = setup({ consent: { publicListing: true }, manifest: expiringManifest })
  const renewal = maintainDirectoryPublication(input)
  const unpublish = unpublishDirectoryProfile(input)
  await renewal
  assert.deepEqual(await unpublish, { status: 'unpublished', listed: false })
  assert.equal(calls.at(-3), 'consent:false:undefined')
  assert.equal(calls.at(-2), 'type-index:remove')
  assert.equal(calls.at(-1), 'manifest:remove')
  assert.equal(calls.filter((call) => call === 'consent:false:undefined').length, 1)
})

void test('coalesces duplicate background maintenance for one account', async () => {
  const { input } = setup({ consent: { publicIndexing: true } })
  let releaseConsent: (() => void) | undefined
  const consentReady = new Promise<void>((resolve) => {
    releaseConsent = resolve
  })
  let consentReads = 0
  const readConsent = input.managers.discoveryConsentManager.readConsent
  input.managers.discoveryConsentManager.readConsent = async (...args) => {
    consentReads += 1
    await consentReady
    return readConsent(...args)
  }

  const first = maintainDirectoryPublication(input)
  const duplicate = maintainDirectoryPublication(input)
  assert.equal(first, duplicate)
  releaseConsent?.()
  await Promise.all([first, duplicate])
  assert.equal(consentReads, 1)
})

void test('stale unlisting maintenance preserves a newer concurrent opt-in', async () => {
  const { input, calls } = setup()
  let consent: DiscoveryConsent = {
    version: 1,
    revision: 4,
    publicationRevision: 4,
    ownerWebId,
    publicListing: false,
    publicIndexing: false,
    nearbyPresence: false,
    inboundContactRequests: false,
    localBroadcasts: false,
    updatedAt: now.toISOString(),
  }
  const newerManifest: DiscoveryManifest = {
    version: 1,
    webId: ownerWebId,
    publicationRevision: 5,
    displayName: 'Alice',
    avatarUrl: 'https://alice.example/avatar.png',
    publicTypeIndexUrl: `${podRoot}settings/publicTypeIndex`,
    publishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 4 * 24 * 60 * 60_000).toISOString(),
  }
  let manifestReads = 0
  input.managers.discoveryConsentManager.readConsent = async () => consent
  input.managers.discoveryManifestManager.readManifest = async () => {
    manifestReads += 1
    if (manifestReads === 1) {
      consent = { ...consent, revision: 5, publicationRevision: 5, publicListing: true }
    }
    return newerManifest
  }
  input.managers.discoveryManifestManager.removeManifestIfUnchanged = async () => {
    throw new Error('A newer manifest must not be removed.')
  }
  input.authFetch = async (request) =>
    new Response(
      JSON.stringify({ listed: !String(request).endsWith('/v1/community-directory/suppress') })
    )

  assert.deepEqual(await maintainDirectoryPublication(input), {
    status: 'published',
    listed: true,
  })
  assert.equal(calls.includes('manifest:remove'), false)
})

void test('conditional manifest delete conflict reconciles the winning opt-in', async () => {
  const { input } = setup()
  let consent: DiscoveryConsent = {
    version: 1,
    revision: 4,
    publicationRevision: 4,
    ownerWebId,
    publicListing: false,
    publicIndexing: false,
    nearbyPresence: false,
    inboundContactRequests: false,
    localBroadcasts: false,
    updatedAt: now.toISOString(),
  }
  const newerManifest: DiscoveryManifest = {
    version: 1,
    webId: ownerWebId,
    publicationRevision: 5,
    displayName: 'Alice',
    avatarUrl: 'https://alice.example/avatar.png',
    publicTypeIndexUrl: `${podRoot}settings/publicTypeIndex`,
    publishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 4 * 24 * 60 * 60_000).toISOString(),
  }
  input.managers.discoveryConsentManager.readConsent = async () => consent
  input.managers.discoveryManifestManager.readManifest = async () =>
    consent.publicListing ? newerManifest : null
  input.managers.discoveryManifestManager.removeManifestIfUnchanged = async () => {
    consent = { ...consent, revision: 5, publicationRevision: 5, publicListing: true }
    return false
  }
  input.authFetch = async (request) =>
    new Response(
      JSON.stringify({ listed: !String(request).endsWith('/v1/community-directory/suppress') })
    )

  assert.deepEqual(await maintainDirectoryPublication(input), {
    status: 'published',
    listed: true,
  })
})

void test('reconciles a transient projection mismatch before reporting pending sync', async () => {
  const { input, manifests } = setup()
  let refreshes = 0
  input.managers.discoveryManifestManager.readManifest = async () => manifests.at(-1) ?? null
  input.authFetch = async (request) => {
    const url = String(request)
    if (url.endsWith('/v1/milestone-q/features')) {
      return new Response(
        JSON.stringify({
          version: 1,
          features: {
            directory: true,
            peerProfile: false,
            relationship: false,
            transport: false,
          },
        })
      )
    }
    refreshes += 1
    return new Response(JSON.stringify({ listed: refreshes > 1 }))
  }

  assert.deepEqual(await publishBasicDirectoryProfile(input), {
    status: 'published',
    listed: true,
  })
  assert.equal(refreshes, 2)
})

void test('suppresses the derived projection before stale artifact cleanup', async () => {
  const { input, calls } = setup()
  input.authFetch = async (request) => {
    const url = String(request)
    if (url.endsWith('/v1/community-directory/suppress')) {
      calls.push('projection:suppress')
      return new Response(JSON.stringify({ listed: false }))
    }
    return new Response(JSON.stringify({ listed: false }))
  }

  assert.deepEqual(await maintainDirectoryPublication(input), {
    status: 'unpublished',
    listed: false,
  })
  assert.equal(calls[0], 'projection:suppress')
  assert.equal(calls.includes('manifest:remove'), true)
})

void test('suppression failure stops destructive artifact cleanup', async () => {
  const { input, calls } = setup()
  input.authFetch = async (request) => {
    if (String(request).endsWith('/v1/community-directory/suppress')) {
      return new Response(
        JSON.stringify({
          code: 'directory_suppress_unavailable',
          error: 'Community directory suppression is temporarily unavailable.',
        }),
        { status: 503 }
      )
    }
    return new Response(JSON.stringify({ listed: false }))
  }

  const outcome = await maintainDirectoryPublication(input)
  assert.equal(outcome.status, 'pending-sync')
  assert.equal(calls.includes('type-index:remove'), false)
  assert.equal(calls.includes('manifest:remove'), false)
})

void test('bounds reconciliation when publication consent keeps changing', async () => {
  const { input } = setup()
  let reads = 0
  input.managers.discoveryConsentManager.readConsent = async () => {
    reads += 1
    const enabled = reads % 2 === 0
    return {
      version: 1,
      revision: reads,
      publicationRevision: reads,
      ownerWebId,
      publicListing: enabled,
      publicIndexing: false,
      nearbyPresence: false,
      inboundContactRequests: false,
      localBroadcasts: false,
      updatedAt: now.toISOString(),
    }
  }
  input.managers.discoveryManifestManager.readManifest = async () => null

  const outcome = await maintainDirectoryPublication(input)
  assert.equal(outcome.status, 'pending-sync')
  assert.equal(reads <= 8, true)
})
