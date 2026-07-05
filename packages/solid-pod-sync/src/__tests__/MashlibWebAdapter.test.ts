import {
  createMashlibWebAdapter,
  inferMashlibResourceType,
} from '../adapters/MashlibWebAdapter.js'

const jestGlobal = import.meta.jest

describe('createMashlibWebAdapter', () => {
  it('is unsupported on non-web runtimes', async () => {
    const adapter = createMashlibWebAdapter({ runtimePlatform: 'native' })

    expect(adapter.isSupported).toBe(false)
    expect(adapter.reason).toContain('web-only')
    expect(adapter.inferResourceType('https://alice.example/public/docustream/')).toBe('generic')
    await expect(adapter.listPanes('https://alice.example/public/')).resolves.toEqual([])
    await expect(adapter.listBoundPanes('https://alice.example/public/docustream/')).resolves.toEqual({
      resourceType: 'generic',
      resourceUrl: 'https://alice.example/public/docustream/',
      panes: [],
    })
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
        'activity',
        { name: 'timeline', title: 'Timeline View' },
      ],
    })

    const adapter = createMashlibWebAdapter({ runtimePlatform: 'web', loader })
    const panes = await adapter.listPanes('https://alice.example/public/docustream/')
    const bound = await adapter.listBoundPanes('https://alice.example/public/docustream/')

    expect(adapter.isSupported).toBe(true)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(adapter.inferResourceType('https://alice.example/public/docustream/')).toBe('docustream')
    expect(panes.map((pane) => pane.id)).toEqual(['tripledoc', 'activity', 'timeline'])
    expect(bound.resourceType).toBe('docustream')
    expect(bound.panes.map((pane) => pane.id)).toEqual(['activity', 'stream', 'timeline', 'tripledoc'])
  })
})

describe('inferMashlibResourceType', () => {
  it('infers known resource classes from URL patterns', () => {
    expect(inferMashlibResourceType('https://alice.example/public/docustream/evt-1')).toBe('docustream')
    expect(inferMashlibResourceType('https://alice.example/profile/card#me')).toBe('profile')
    expect(inferMashlibResourceType('https://alice.example/public/graph/connections.ttl')).toBe('social-graph')
    expect(inferMashlibResourceType('https://alice.example/public/notes/today')).toBe('generic')
  })
})