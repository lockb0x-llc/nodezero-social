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
    const fetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 200 }))

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

    await expect(
      docustreamManager.appendActivity('https://alice.example/', {
        id: 'evt_1',
        source: 'nodezero',
        author: 'Alice',
        content: 'Hello',
        timestamp: '2026-07-05T12:00:00.000Z',
      })
    ).rejects.toThrow('DocuStream writes are temporarily disabled during the storage refactor lock.')

    await socialGraph.addConnection(
      'https://alice.example/',
      'https://bob.example/profile/card#me'
    )

    await expect(
      docustreamSourceManager.upsertSource('https://alice.example/', {
        type: 'rss',
        url: 'https://feeds.example.com/main.xml',
        title: 'Main Feed',
      })
    ).rejects.toThrow(
      'DocuStream source mutations are temporarily disabled during the storage refactor lock.'
    )

    await profilePreferencesManager.writePreferences('https://alice.example/', {
      interests: ['solid'],
      isNsfw: false,
    })

    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledTimes(3)
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
