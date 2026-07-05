import { createSolidPodSyncManagers } from '../createSolidPodSyncManagers.js'

const jestGlobal = import.meta.jest

describe('createSolidPodSyncManagers', () => {
  it('applies shared bootstrap hook to all write managers when enabled', async () => {
    const ensureDefaultLayoutAndPolicies = jestGlobal.fn().mockResolvedValue(undefined)
    const fetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 200 }))

    const { profileManager, docustreamManager, socialGraph } = createSolidPodSyncManagers(
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
    ).rejects.toThrow('Data Backpack contract validation failed')

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
    ).rejects.toThrow('Data Backpack contract validation failed')

    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledTimes(0)
  })
})
