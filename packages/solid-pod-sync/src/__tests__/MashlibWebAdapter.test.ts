import { createMashlibWebAdapter } from '../adapters/MashlibWebAdapter.js'

const jestGlobal = import.meta.jest

describe('createMashlibWebAdapter', () => {
  it('is unsupported on non-web runtimes', async () => {
    const adapter = createMashlibWebAdapter({ runtimePlatform: 'native' })

    expect(adapter.isSupported).toBe(false)
    expect(adapter.reason).toContain('web-only')
    await expect(adapter.listPanes('https://alice.example/public/')).resolves.toEqual([])
  })

  it('is unsupported on web when no loader is configured', async () => {
    const adapter = createMashlibWebAdapter({ runtimePlatform: 'web' })

    expect(adapter.isSupported).toBe(false)
    expect(adapter.reason).toContain('loader')
    await expect(adapter.listPanes('https://alice.example/public/')).resolves.toEqual([])
  })

  it('uses provided loader on web runtime', async () => {
    const loader = jestGlobal.fn().mockResolvedValue({
      listPanes: () => [
        { id: 'tripledoc', label: 'Tripledoc View' },
        { id: 'activity', label: 'Activity Stream' },
      ],
    })

    const adapter = createMashlibWebAdapter({ runtimePlatform: 'web', loader })
    const panes = await adapter.listPanes('https://alice.example/public/docustream/')

    expect(adapter.isSupported).toBe(true)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(panes.map((pane) => pane.id)).toEqual(['tripledoc', 'activity'])
  })
})