import { DocustreamManager } from '../DocustreamManager.js'
import { ProfileManager } from '../ProfileManager.js'
import { intersectInterests } from '../SocialGraph.js'

const jestGlobal = import.meta.jest

describe('DocustreamManager', () => {
  it('appendActivity stores item in Pod', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: true })
    const manager = new DocustreamManager({ fetch })

    await manager.appendActivity('https://alice.example/', {
      id: 'abc123',
      source: 'rss',
      author: 'Alice',
      title: 'My first post',
      content: 'Hello world',
      timestamp: '2026-06-27T00:00:00.000Z',
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://alice.example/public/docustream/abc123.jsonld')
    expect(options).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/ld+json' },
    })
    expect(String(options?.body)).toContain('Hello world')
  })

  it('appendActivity rejects invalid contract payloads', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: true })
    const manager = new DocustreamManager({ fetch })

    await expect(
      manager.appendActivity('https://alice.example/', {
        id: 'bad id with spaces',
        source: 'nodezero',
        author: 'Alice',
        content: 'Hello world',
        timestamp: 'not-a-date',
      })
    ).rejects.toThrow('DocuStream contract validation failed')

    expect(fetch).toHaveBeenCalledTimes(0)
  })

  it('listActivities filters out invalid items from container listing', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<https://alice.example/public/docustream/good1.jsonld> <https://alice.example/public/docustream/bad1.jsonld>',
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            '@id': 'nodezero:docustream/good1',
            source: 'rss',
            author: 'Alice',
            content: 'Valid item',
            timestamp: '2026-07-01T00:00:00.000Z',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            '@id': 'nodezero:docustream/bad1',
            source: 'rss',
            author: 'Alice',
            content: 'Invalid item',
            timestamp: 'invalid-timestamp',
          }),
      })

    const manager = new DocustreamManager({ fetch })
    const items = await manager.listActivities('https://alice.example/')

    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('good1')
  })
})

describe('intersectInterests', () => {
  it('returns intersection of interests', () => {
    expect(intersectInterests(['web3', 'art'], ['web3', 'music'])).toEqual(['web3'])
  })
})

describe('ProfileManager.updateWebACL', () => {
  it('patches .acl for public read', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: true })
    const manager = new ProfileManager({ fetch })

    await manager.updateWebACL('https://alice.example/public/docustream', true)

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://alice.example/public/docustream/.acl')
    expect(options).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
    })
    expect(String(options?.body)).toContain('acl:agent <https://alice.example/profile/card#me>')
    expect(String(options?.body)).toContain('acl:agentClass foaf:Agent')
    expect(String(options?.body)).toContain('acl:accessTo <https://alice.example/public/docustream>')
  })
})