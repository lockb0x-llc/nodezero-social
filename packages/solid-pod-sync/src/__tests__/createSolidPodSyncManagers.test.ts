import { createSolidPodSyncManagers } from '../createSolidPodSyncManagers.js'

const jestGlobal = import.meta.jest

describe('createSolidPodSyncManagers', () => {
  it('returns notification manager in the shared manager set', () => {
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: true })

    const managers = createSolidPodSyncManagers({ fetch })

    expect(managers.notificationManager).toBeDefined()
    expect(managers.profilePreferencesManager).toBeDefined()
    expect(typeof managers.notificationManager.getPreferences).toBe('function')
    expect(typeof managers.profilePreferencesManager.readPreferences).toBe('function')
  })

  it('applies shared bootstrap hook to all write managers when enabled', async () => {
    const ensureDefaultLayoutAndPolicies = jestGlobal.fn().mockResolvedValue(undefined)
    let activity = ''
    let registry: string | null = null
    let profile = `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <https://alice.example/profile/card#me> a foaf:Person .
    `
    const fetch = jestGlobal.fn().mockImplementation(async (rawUrl: string, init?: RequestInit) => {
      const url = String(rawUrl)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/public/docustream/evt_1.jsonld')) {
        if (method === 'PUT') {
          activity = String(init?.body ?? '')
          return new Response('', { status: 201 })
        }
        return new Response(activity, { status: 200 })
      }
      if (url.endsWith('/public/docustream-sources.jsonld')) {
        if (method === 'GET') {
          return registry === null
            ? new Response('', { status: 404 })
            : new Response(registry, {
                status: 200,
                headers: { etag: '"sources-1"' },
              })
        }
        registry = String(init?.body ?? '')
        return new Response('', { status: 201 })
      }
      if (url.endsWith('/profile/card')) {
        if (method === 'GET') {
          return new Response(profile, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        }
        const patch = String(init?.body ?? '')
        profile += Array.from(
          patch.matchAll(
            /<https:\/\/alice\.example\/profile\/card#me> <(https:\/\/nodezero\.social\/ns#docustream[^>]+)> <([^>]+)> \./g,
          ),
        ).map((match) => `\n<https://alice.example/profile/card#me> <${match[1]}> <${match[2]}> .`).join('')
        return new Response('', { status: 200 })
      }
      return new Response('', { status: 200 })
    })

    const {
      profileManager,
      profilePreferencesManager,
      docustreamManager,
      docustreamSourceManager,
      socialGraph,
    } = createSolidPodSyncManagers(
      { fetch },
      {
        enablePodBootstrap: true,
        podLayoutManager: { ensureDefaultLayoutAndPolicies },
      }
    )

    await expect(
      profileManager.writeProfile('https://alice.example/', {
        displayName: '',
        bio: 'invalid on purpose',
        interests: ['solid'],
        isNsfw: false,
      })
    ).rejects.toThrow('Public profile contract validation failed')

    await docustreamManager.appendActivity('https://alice.example/', {
      id: 'evt_1',
      source: 'nodezero',
      author: 'Alice',
      content: 'Hello',
      timestamp: '2026-07-05T12:00:00.000Z',
    })

    await socialGraph.addConnection(
      'https://alice.example/',
      'https://bob.example/profile/card#me'
    )

    await docustreamSourceManager.upsertSource('https://alice.example/', {
      type: 'rss',
      url: 'https://feeds.example.com/main.xml',
      title: 'Main Feed',
    })

    await profilePreferencesManager.writePreferences('https://alice.example/', {
      interests: ['solid'],
      isNsfw: false,
    })

    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledTimes(5)
    expect(ensureDefaultLayoutAndPolicies).toHaveBeenNthCalledWith(
      1,
      'https://alice.example/',
      expect.any(Object)
    )
    expect(ensureDefaultLayoutAndPolicies).toHaveBeenNthCalledWith(
      2,
      'https://alice.example/',
      expect.any(Object)
    )
    expect(ensureDefaultLayoutAndPolicies).toHaveBeenNthCalledWith(
      3,
      'https://alice.example/',
      expect.any(Object)
    )
    expect(ensureDefaultLayoutAndPolicies).toHaveBeenNthCalledWith(
      4,
      'https://alice.example/',
      expect.any(Object)
    )
    expect(ensureDefaultLayoutAndPolicies).toHaveBeenNthCalledWith(
      5,
      'https://alice.example/',
      expect.any(Object)
    )
  })

  it('keeps bootstrap disabled by default', async () => {
    const ensureDefaultLayoutAndPolicies = jestGlobal.fn().mockResolvedValue(undefined)
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: true })

    const { profileManager } = createSolidPodSyncManagers(
      { fetch },
      {
        podLayoutManager: { ensureDefaultLayoutAndPolicies },
      }
    )

    await expect(
      profileManager.writeProfile('https://alice.example/', {
        displayName: '',
        bio: 'invalid on purpose',
        interests: ['solid'],
        isNsfw: false,
      })
    ).rejects.toThrow('Public profile contract validation failed')

    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledTimes(0)
  })
})
