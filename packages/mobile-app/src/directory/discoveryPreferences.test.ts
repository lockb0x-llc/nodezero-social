import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DiscoveryConsent, DiscoveryManifest } from '@nodezero/solid-pod-sync'
import type { UpdateDiscoveryPreferencesInput } from './discoveryPreferences'
import { DiscoveryPreferencesError, updateDiscoveryPreferences } from './discoveryPreferences'

const alice = 'https://alice.example/profile/card#me'
const podRoot = 'https://alice.example/'
const now = new Date('2026-08-01T12:00:00.000Z')

function setup(): {
  input: UpdateDiscoveryPreferencesInput
  calls: string[]
  writtenManifest: DiscoveryManifest[]
} {
  const calls: string[] = []
  const writtenManifest: DiscoveryManifest[] = []
  let consent: DiscoveryConsent = {
    version: 1 as const,
    revision: 0,
    ownerWebId: alice,
    publicListing: false,
    publicIndexing: false,
    nearbyPresence: false,
    inboundContactRequests: false,
    localBroadcasts: false,
    updatedAt: now.toISOString(),
  }
  const input: UpdateDiscoveryPreferencesInput = {
    podRoot,
    ownerWebId: alice,
    preferences: {
      publicListing: true,
      publicIndexing: true,
      nearbyPresence: false,
      localBroadcasts: false,
      selectedPublicInterests: ['Privacy'],
    },
    baselineConsent: {
      publicListing: false,
      publicIndexing: false,
      nearbyPresence: false,
      localBroadcasts: false,
    },
    provisionerUrl: 'https://api.nodezero.example',
    authFetch: async (url) => {
      calls.push(`refresh:${String(url)}`)
      return new Response(JSON.stringify({ listed: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
    managers: {
      discoveryConsentManager: {
        readConsent: async () => consent,
        updateConsent: async (_root, patch, updatedAt) => {
          calls.push(`consent:${patch.publicListing}:${patch.publicIndexing}`)
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
        readManifest: async () => null,
        writeManifest: async (_root, manifest) => {
          calls.push('manifest:write')
          writtenManifest.push(manifest)
          return `${podRoot}public/discovery/manifest`
        },
        removeManifestIfUnchanged: async () => {
          calls.push('manifest:remove')
          return true
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
          return `${podRoot}settings/publicTypeIndex#registration`
        },
        removeDiscoveryManifestRegistration: async () => {
          calls.push('type-index:remove')
          return true
        },
      },
      profileManager: {
        readProfile: async () => ({
          displayName: 'Alice',
          avatarUrl: 'https://alice.example/public/avatar.png',
          bio: '',
          interests: [],
          isNsfw: false,
        }),
      },
      profilePreferencesManager: {
        readPreferences: async () => ({
          interests: ['Solid', 'Privacy', 'Music'],
          isNsfw: false,
        }),
      },
    },
    now,
  }
  return { input, calls, writtenManifest }
}

void test('publishes only explicitly selected public interests and refreshes projection', async () => {
  const { input, calls, writtenManifest } = setup()
  const result = await updateDiscoveryPreferences(input)

  assert.equal(result.listed, true)
  assert.deepEqual(result.selectedPublicInterests, ['Privacy'])
  assert.equal(writtenManifest[0]?.publicationRevision, 2)
  assert.deepEqual(writtenManifest[0]?.publicInterests, ['Privacy'])
  assert.equal(JSON.stringify(writtenManifest[0]).includes('Solid'), false)
  assert.equal(JSON.stringify(writtenManifest[0]).includes('Music'), false)
  assert.deepEqual(calls, [
    'consent:true:true',
    'manifest:write',
    'type-index:register',
    'refresh:https://api.nodezero.example/v1/community-directory/refresh',
  ])
})

void test('provisions a missing public Type Index for explicit Directory publication', async () => {
  const { input, calls, writtenManifest } = setup()
  input.requirePublicTypeIndex = true
  input.managers.publicTypeIndexManager.discoverPublicTypeIndex = async () => null

  const result = await updateDiscoveryPreferences(input)

  assert.equal(result.listed, true)
  assert.equal(writtenManifest[0]?.publicTypeIndexUrl, `${podRoot}public/discovery/type-index`)
  assert.deepEqual(calls, [
    'consent:true:true',
    'type-index:ensure',
    'manifest:write',
    'type-index:register',
    'refresh:https://api.nodezero.example/v1/community-directory/refresh',
  ])
})

void test('forcePublicIndexingOff overrides a concurrent indexing enablement', async () => {
  const { input, writtenManifest } = setup()
  input.baselineConsent.publicIndexing = false
  input.preferences.publicIndexing = false
  input.forcePublicIndexingOff = true
  input.managers.discoveryConsentManager.readConsent = async () => ({
    version: 1,
    ownerWebId: alice,
    publicListing: false,
    publicIndexing: true,
    nearbyPresence: false,
    inboundContactRequests: false,
    localBroadcasts: false,
    updatedAt: now.toISOString(),
  })
  await updateDiscoveryPreferences(input)
  assert.equal(writtenManifest[0]?.publicInterests, undefined)
  assert.equal(writtenManifest[0]?.capabilities, undefined)
  assert.equal(writtenManifest[0]?.inboxUrl, undefined)
})

void test('keeps listing and indexing independent in the public manifest', async () => {
  const listingOnly = setup()
  listingOnly.input.preferences = {
    publicListing: true,
    publicIndexing: false,
    nearbyPresence: false,
    localBroadcasts: false,
    selectedPublicInterests: ['Privacy'],
  }
  await updateDiscoveryPreferences(listingOnly.input)
  assert.equal(listingOnly.calls.includes('manifest:write'), true)
  assert.equal(listingOnly.writtenManifest[0]?.publicInterests, undefined)
  assert.equal(listingOnly.writtenManifest[0]?.capabilities, undefined)

  const indexingOnly = setup()
  indexingOnly.input.preferences = {
    publicListing: false,
    publicIndexing: true,
    nearbyPresence: false,
    localBroadcasts: false,
    selectedPublicInterests: ['Privacy'],
  }
  indexingOnly.input.authFetch = async () =>
    new Response(JSON.stringify({ listed: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  const indexed = await updateDiscoveryPreferences(indexingOnly.input)
  assert.equal(indexed.listed, false)
  assert.deepEqual(indexingOnly.writtenManifest[0]?.publicInterests, ['Privacy'])
  assert.equal(indexingOnly.writtenManifest[0]?.publicationRevision, 2)
  assert.equal(indexingOnly.calls.includes('type-index:register'), true)
})

void test('removes the public manifest only when both public scopes are off', async () => {
  const { input, calls } = setup()
  input.preferences = {
    publicListing: false,
    publicIndexing: false,
    nearbyPresence: false,
    localBroadcasts: false,
    selectedPublicInterests: [],
  }
  input.authFetch = async () =>
    new Response(JSON.stringify({ listed: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  const result = await updateDiscoveryPreferences(input)
  assert.equal(result.listed, false)
  assert.equal(calls.includes('manifest:remove'), true)
  assert.equal(calls.includes('type-index:remove'), true)
  assert.equal(calls.includes('manifest:write'), false)
})

void test('refreshes authoritative opt-out when public manifest cleanup fails', async () => {
  const { input, calls } = setup()
  input.preferences = {
    publicListing: false,
    publicIndexing: false,
    nearbyPresence: false,
    localBroadcasts: false,
    selectedPublicInterests: [],
  }
  input.managers.discoveryManifestManager.removeManifestIfUnchanged = async () => {
    calls.push('manifest:remove')
    throw new Error('Pod delete failed')
  }
  input.authFetch = async (url) => {
    calls.push(`refresh:${String(url)}`)
    return new Response(JSON.stringify({ listed: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  await assert.rejects(
    updateDiscoveryPreferences(input),
    (error: unknown) =>
      error instanceof DiscoveryPreferencesError && error.code === 'manifest_cleanup_failed'
  )
  assert.deepEqual(calls.slice(0, 4), [
    'refresh:https://api.nodezero.example/v1/community-directory/suppress',
    'type-index:remove',
    'manifest:remove',
    'refresh:https://api.nodezero.example/v1/community-directory/refresh',
  ])
})

void test('rejects public interests that were not explicitly selected from private state', async () => {
  const { input, calls } = setup()
  input.preferences.selectedPublicInterests = ['Medical']
  await assert.rejects(
    updateDiscoveryPreferences(input),
    (error: unknown) =>
      error instanceof DiscoveryPreferencesError && error.code === 'public_interest_not_owned'
  )
  assert.deepEqual(calls, [])
})

void test('rejects an interest present only in an unsaved editor draft', async () => {
  const { input, calls } = setup()
  input.preferences.selectedPublicInterests = ['Draft only']

  await assert.rejects(
    updateDiscoveryPreferences(input),
    (error: unknown) =>
      error instanceof DiscoveryPreferencesError && error.code === 'public_interest_not_owned'
  )
  assert.deepEqual(calls, [])
})

void test('preserves revocation and rolls back enablement when manifest publication fails', async () => {
  const { input, calls } = setup()
  input.baselineConsent = {
    publicListing: true,
    publicIndexing: false,
    nearbyPresence: false,
    localBroadcasts: false,
  }
  let consent: DiscoveryConsent = {
    version: 1,
    revision: 0,
    publicationRevision: 0,
    ownerWebId: alice,
    publicListing: true,
    publicIndexing: false,
    nearbyPresence: false,
    inboundContactRequests: false,
    localBroadcasts: false,
    updatedAt: now.toISOString(),
  }
  input.managers.discoveryConsentManager.readConsent = async () => consent
  input.managers.discoveryConsentManager.updateConsent = async (_root, patch, updatedAt) => {
    calls.push(`consent:${String(patch.publicListing)}:${String(patch.publicIndexing)}`)
    consent = {
      ...consent,
      ...patch,
      revision: (consent.revision ?? 0) + 1,
      publicationRevision: (consent.publicationRevision ?? 0) + 1,
      publicationUpdatedAt: updatedAt,
      updatedAt: updatedAt ?? now.toISOString(),
    }
    return consent
  }
  input.managers.discoveryConsentManager.reservePublicationRevision = async (
    _root,
    _expected,
    updatedAt
  ) => {
    consent = {
      ...consent,
      revision: (consent.revision ?? 0) + 1,
      publicationRevision: (consent.publicationRevision ?? 0) + 1,
      publicationUpdatedAt: updatedAt,
      updatedAt: updatedAt ?? now.toISOString(),
    }
    return consent
  }
  input.preferences = {
    publicListing: false,
    publicIndexing: true,
    nearbyPresence: false,
    localBroadcasts: false,
    selectedPublicInterests: ['Privacy'],
  }
  input.managers.discoveryManifestManager.writeManifest = async () => {
    calls.push('manifest:write')
    throw new Error('Pod write failed')
  }
  input.authFetch = async (url) => {
    calls.push(`refresh:${String(url)}`)
    return new Response(JSON.stringify({ listed: false }), { status: 200 })
  }

  await assert.rejects(
    updateDiscoveryPreferences(input),
    (error: unknown) =>
      error instanceof DiscoveryPreferencesError && error.code === 'manifest_publish_failed'
  )
  assert.equal(calls.includes('consent:undefined:false'), true)
  assert.equal(calls.at(-1), 'refresh:https://api.nodezero.example/v1/community-directory/refresh')
})

void test('does not resurrect a fresh cross-device opt-out from stale unchanged state', async () => {
  const { input } = setup()
  input.baselineConsent = {
    publicListing: true,
    publicIndexing: false,
    nearbyPresence: false,
    localBroadcasts: false,
  }
  input.preferences = {
    publicListing: true,
    publicIndexing: false,
    nearbyPresence: true,
    localBroadcasts: false,
    selectedPublicInterests: [],
  }
  input.managers.discoveryConsentManager.readConsent = async () => ({
    version: 1,
    ownerWebId: alice,
    publicListing: false,
    publicIndexing: false,
    nearbyPresence: false,
    inboundContactRequests: false,
    localBroadcasts: false,
    updatedAt: '2026-08-01T12:01:00.000Z',
  })
  input.authFetch = async (url) =>
    new Response(
      JSON.stringify({ listed: !String(url).endsWith('/v1/community-directory/suppress') })
    )

  const result = await updateDiscoveryPreferences(input)
  assert.equal(result.consent.publicListing, false)
  assert.equal(result.consent.nearbyPresence, true)
})

void test('removes a manifest recreated after a concurrent full opt-out', async () => {
  const { input, calls } = setup()
  let consent = await input.managers.discoveryConsentManager.readConsent(podRoot)
  input.managers.discoveryConsentManager.readConsent = async () => consent
  input.managers.discoveryConsentManager.updateConsent = async (_root, patch, updatedAt) => {
    consent = {
      ...consent,
      ...patch,
      revision: (consent.revision ?? 0) + 1,
      updatedAt: updatedAt ?? now.toISOString(),
    }
    return consent
  }
  input.managers.discoveryManifestManager.writeManifest = async () => {
    calls.push('manifest:write')
    consent = {
      ...consent,
      publicListing: false,
      publicIndexing: false,
      revision: (consent.revision ?? 0) + 1,
    }
    return `${podRoot}public/discovery/manifest`
  }
  input.authFetch = async (url) => {
    calls.push(`refresh:${String(url)}`)
    return new Response(JSON.stringify({ listed: false }), { status: 200 })
  }

  const result = await updateDiscoveryPreferences(input)
  assert.equal(result.consent.publicListing, false)
  assert.equal(calls.includes('manifest:remove'), true)
  assert.equal(calls.includes('type-index:register'), false)
})

void test('preserves a higher-revision opt-in that supersedes unpublish cleanup', async () => {
  const { input, calls } = setup()
  let consent: DiscoveryConsent = {
    version: 1,
    revision: 4,
    publicationRevision: 4,
    ownerWebId: alice,
    publicListing: true,
    publicIndexing: false,
    nearbyPresence: false,
    inboundContactRequests: false,
    localBroadcasts: false,
    updatedAt: now.toISOString(),
  }
  let reads = 0
  input.baselineConsent.publicListing = true
  input.preferences = {
    publicListing: false,
    publicIndexing: false,
    nearbyPresence: false,
    localBroadcasts: false,
    selectedPublicInterests: [],
  }
  input.managers.discoveryConsentManager.readConsent = async () => {
    reads += 1
    if (reads === 2) {
      consent = { ...consent, revision: 6, publicationRevision: 6, publicListing: true }
    }
    return consent
  }
  input.managers.discoveryConsentManager.updateConsent = async (_root, patch, updatedAt) => {
    consent = {
      ...consent,
      ...patch,
      revision: 5,
      publicationRevision: 5,
      updatedAt: updatedAt ?? now.toISOString(),
    }
    return consent
  }
  input.authFetch = async (url) => {
    calls.push(`refresh:${String(url)}`)
    return new Response(
      JSON.stringify({ listed: !String(url).endsWith('/v1/community-directory/suppress') })
    )
  }

  const result = await updateDiscoveryPreferences(input)
  assert.equal(result.consent.revision, 6)
  assert.equal(result.consent.publicListing, true)
  assert.equal(result.listed, true)
  assert.equal(calls.includes('manifest:remove'), false)
  assert.equal(calls.includes('type-index:remove'), false)
})

void test('full opt-out wins after an indexing-only writer creates its manifest', async () => {
  const { input, calls } = setup()
  let consent: DiscoveryConsent = {
    version: 1,
    revision: 4,
    publicationRevision: 4,
    ownerWebId: alice,
    publicListing: false,
    publicIndexing: true,
    nearbyPresence: false,
    inboundContactRequests: false,
    localBroadcasts: false,
    updatedAt: now.toISOString(),
  }
  input.baselineConsent = {
    publicListing: false,
    publicIndexing: true,
    nearbyPresence: false,
    localBroadcasts: false,
  }
  input.preferences = {
    publicListing: false,
    publicIndexing: true,
    nearbyPresence: false,
    localBroadcasts: false,
    selectedPublicInterests: [],
  }
  input.preserveIndependentIndexingArtifacts = true
  input.managers.discoveryConsentManager.readConsent = async () => consent
  input.managers.discoveryConsentManager.reservePublicationRevision = async (
    _root,
    expected,
    updatedAt
  ) => {
    assert.equal(expected, 4)
    consent = {
      ...consent,
      revision: 5,
      publicationRevision: 5,
      publicationUpdatedAt: updatedAt,
      updatedAt: updatedAt ?? now.toISOString(),
    }
    return consent
  }
  input.managers.discoveryManifestManager.writeManifest = async () => {
    calls.push('manifest:write')
    consent = {
      ...consent,
      revision: 6,
      publicationRevision: 6,
      publicIndexing: false,
      publicationUpdatedAt: now.toISOString(),
    }
    return `${podRoot}public/discovery/manifest`
  }
  input.authFetch = async (url) => {
    if (String(url).endsWith('/v1/community-directory/suppress')) {
      calls.push('projection:suppress')
      return new Response(JSON.stringify({ listed: false }))
    }
    calls.push(`refresh:${String(url)}`)
    return new Response(JSON.stringify({ listed: false }))
  }

  const result = await updateDiscoveryPreferences(input)
  assert.equal(result.consent.publicIndexing, false)
  assert.equal(result.listed, false)
  assert.equal(calls.includes('manifest:write'), true)
  assert.equal(calls.includes('manifest:remove'), true)
  assert.equal(calls.includes('type-index:register'), false)
  assert.equal(calls.includes('projection:suppress'), true)
})

void test('already-disabled full cleanup stops when projection suppression fails', async () => {
  const { input, calls } = setup()
  input.preferences = {
    publicListing: false,
    publicIndexing: false,
    nearbyPresence: false,
    localBroadcasts: false,
    selectedPublicInterests: [],
  }
  input.authFetch = async (url) => {
    calls.push(`refresh:${String(url)}`)
    return new Response(
      JSON.stringify({
        code: 'directory_suppress_unavailable',
        error: 'Community directory suppression is temporarily unavailable.',
      }),
      { status: 503 }
    )
  }

  await assert.rejects(updateDiscoveryPreferences(input), (error: unknown) => {
    return error instanceof DiscoveryPreferencesError && error.code === 'directory_suppress_unavailable'
  })
  assert.equal(calls.includes('type-index:remove'), false)
  assert.equal(calls.includes('manifest:remove'), false)
})
