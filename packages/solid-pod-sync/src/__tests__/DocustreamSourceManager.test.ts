import { DocustreamSourceManager } from '../DocustreamSourceManager.js'

const jestGlobal = import.meta.jest

describe('DocustreamSourceManager', () => {
  it('blocks source mutations during docustream freeze', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true })

    const manager = new DocustreamSourceManager({ fetch })

    await expect(
      manager.upsertSource('https://alice.example/', {
        url: 'https://example.com/feed.xml',
        title: 'Example Feed',
      })
    ).rejects.toThrow(
      'DocuStream source mutations are temporarily disabled during the storage refactor lock.'
    )

    expect(fetch).toHaveBeenCalledTimes(0)
  })

  it('listSources returns parsed sources from registry payload', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          '@id': 'nodezero:docustream-sources',
          sources: [
            {
              id: 'rss_123',
              type: 'rss',
              url: 'https://example.com/feed.xml',
              enabled: true,
              createdAt: '2026-07-05T00:00:00.000Z',
              updatedAt: '2026-07-05T00:00:00.000Z',
            },
          ],
        }),
    })

    const manager = new DocustreamSourceManager({ fetch })
    const sources = await manager.listSources('https://alice.example/')

    expect(sources).toHaveLength(1)
    expect(sources[0]?.url).toBe('https://example.com/feed.xml')
  })
})
