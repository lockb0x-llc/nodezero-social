import { ProfilePreferencesManager } from '../ProfilePreferencesManager.js'

const jestGlobal = import.meta.jest

describe('ProfilePreferencesManager', () => {
  it('writes validated preferences to private backpack preferences path', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: true, status: 201 })
    const manager = new ProfilePreferencesManager({ fetch })

    const url = await manager.writePreferences('https://alice.example/', {
      interests: ['solid', 'privacy'],
      isNsfw: false,
    })

    expect(url).toBe('https://alice.example/backpack/preferences/profile.json')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('https://alice.example/backpack/preferences/profile.json')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('reads and validates preferences payload', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ interests: ['solid'], isNsfw: true }),
    })
    const manager = new ProfilePreferencesManager({ fetch })

    const preferences = await manager.readPreferences('https://alice.example/')

    expect(preferences).toEqual({ interests: ['solid'], isNsfw: true })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns null on missing preferences document', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: false, status: 404 })
    const manager = new ProfilePreferencesManager({ fetch })

    const preferences = await manager.readPreferences('https://alice.example/')
    expect(preferences).toBeNull()
  })

  it('runs pod bootstrap before write when enabled', async () => {
    const ensureDefaultLayoutAndPolicies = jestGlobal.fn().mockResolvedValue(undefined)
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: true, status: 201 })
    const manager = new ProfilePreferencesManager(
      { fetch },
      {
        enablePodBootstrap: true,
        podLayoutManager: { ensureDefaultLayoutAndPolicies },
      }
    )

    await manager.writePreferences('https://alice.example/', {
      interests: ['solid'],
      isNsfw: false,
    })

    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledTimes(1)
    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledWith('https://alice.example/', expect.any(Object))
  })
})
