import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DiscoveryManifest } from '@nodezero/solid-pod-sync'
import type { UpdateDiscoveryPreferencesInput } from './discoveryPreferences'
import {
  DiscoveryPreferencesError,
  updateDiscoveryPreferences,
} from './discoveryPreferences'

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
        readConsent: async () => ({
          version: 1,
          ownerWebId: alice,
          publicListing: false,
          publicIndexing: false,
          nearbyPresence: false,
          inboundContactRequests: false,
          localBroadcasts: false,
          updatedAt: now.toISOString(),
        }),
        updateConsent: async (_root, patch, updatedAt) => {
          calls.push(`consent:${patch.publicListing}:${patch.publicIndexing}`)
          return {
            version: 1,
            ownerWebId: alice,
            publicListing: patch.publicListing ?? false,
            publicIndexing: patch.publicIndexing ?? false,
            nearbyPresence: patch.nearbyPresence ?? false,
            inboundContactRequests: false,
            localBroadcasts: patch.localBroadcasts ?? false,
            updatedAt: updatedAt ?? now.toISOString(),
          }
        },
      },
      discoveryManifestManager: {
        writeManifest: async (_root, manifest) => {
          calls.push('manifest:write')
          writtenManifest.push(manifest)
          return `${podRoot}public/discovery/manifest`
        },
        removeManifest: async () => {
          calls.push('manifest:remove')
        },
      },
      publicTypeIndexManager: {
        discoverPublicTypeIndex: async () => `${podRoot}settings/publicTypeIndex`,
        ensureDiscoveryManifestRegistration: async () => {
          calls.push('type-index:register')
          return `${podRoot}settings/publicTypeIndex#registration`
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
  assert.deepEqual(writtenManifest[0]?.publicInterests, ['Privacy'])
  assert.equal(JSON.stringify(writtenManifest[0]).includes('Solid'), false)
  assert.equal(JSON.stringify(writtenManifest[0]).includes('Music'), false)
  assert.deepEqual(calls, [
    'consent:true:true',
    'manifest:remove',
    'manifest:write',
    'type-index:register',
    'refresh:https://api.nodezero.example/v1/community-directory/refresh',
  ])
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
  indexingOnly.input.authFetch = async () => new Response(JSON.stringify({ listed: false }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  const indexed = await updateDiscoveryPreferences(indexingOnly.input)
  assert.equal(indexed.listed, false)
  assert.deepEqual(indexingOnly.writtenManifest[0]?.publicInterests, ['Privacy'])
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
  input.authFetch = async () => new Response(JSON.stringify({ listed: false }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  const result = await updateDiscoveryPreferences(input)
  assert.equal(result.listed, false)
  assert.equal(calls.includes('manifest:remove'), true)
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
  input.managers.discoveryManifestManager.removeManifest = async () => {
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
  assert.deepEqual(calls.slice(0, 3), [
    'consent:false:false',
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
  input.managers.discoveryConsentManager.readConsent = async () => ({
    version: 1,
    ownerWebId: alice,
    publicListing: true,
    publicIndexing: false,
    nearbyPresence: false,
    inboundContactRequests: false,
    localBroadcasts: false,
    updatedAt: now.toISOString(),
  })
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
  assert.equal(calls.includes('consent:false:false'), true)
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

  const result = await updateDiscoveryPreferences(input)
  assert.equal(result.consent.publicListing, false)
  assert.equal(result.consent.nearbyPresence, true)
})
