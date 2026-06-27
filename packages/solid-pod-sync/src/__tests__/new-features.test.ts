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