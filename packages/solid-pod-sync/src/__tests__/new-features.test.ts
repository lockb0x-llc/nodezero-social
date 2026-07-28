import { DocustreamManager } from '../DocustreamManager.js'
import { ProfileManager } from '../ProfileManager.js'
import { SocialGraph } from '../SocialGraph.js'
import { intersectInterests } from '../SocialGraph.js'

const jestGlobal = import.meta.jest

describe('DocustreamManager', () => {
  it('appendActivity writes JSON-LD and verifies the persisted item', async () => {
    let persistedBody = ''
    const fetch = jestGlobal.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        persistedBody = String(init.body ?? '')
        return new Response('', { status: 201 })
      }
      return new Response(persistedBody, {
        status: 200,
        headers: { 'content-type': 'application/ld+json' },
      })
    })
    const manager = new DocustreamManager({ fetch })
    const item = {
      id: 'abc123',
      source: 'rss' as const,
      author: 'Alice',
      title: 'My first post',
      content: 'Hello world',
      timestamp: '2026-06-27T00:00:00.000Z',
    }

    await manager.appendActivity('https://alice.example/', item)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://alice.example/public/docustream/abc123.jsonld',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(JSON.parse(persistedBody)).toMatchObject({ content: 'Hello world' })
  })

  it('appendActivity rejects invalid payloads before writing', async () => {
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

  it('runs pod bootstrap before verified writes when enabled', async () => {
    const ensureDefaultLayoutAndPolicies = jestGlobal.fn().mockResolvedValue(undefined)
    let persistedBody = ''
    const fetch = jestGlobal.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        persistedBody = String(init.body ?? '')
        return new Response('', { status: 201 })
      }
      return new Response(persistedBody, { status: 200 })
    })
    const manager = new DocustreamManager(
      { fetch },
      {
        enablePodBootstrap: true,
        podLayoutManager: { ensureDefaultLayoutAndPolicies },
      }
    )

    await manager.appendActivity('https://alice.example/', {
      id: 'abc123',
      source: 'nodezero',
      author: 'Alice',
      content: 'Hello world',
      timestamp: '2026-07-05T00:00:00.000Z',
    })

    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledTimes(1)
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

describe('ProfileManager.writeProfile', () => {
  it('rejects invalid Data Backpack profile contract payloads', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: true })
    const manager = new ProfileManager({ fetch })

    await expect(
      manager.writeProfile('https://alice.example/', {
        displayName: '',
        bio: 'Missing display name',
        interests: ['solid'],
        isNsfw: false,
      })
    ).rejects.toThrow('Public profile contract validation failed')

    expect(fetch).toHaveBeenCalledTimes(0)
  })

  it('runs pod bootstrap before profile write when enabled', async () => {
    const ensureDefaultLayoutAndPolicies = jestGlobal.fn().mockResolvedValue(undefined)
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: true })

    const manager = new ProfileManager(
      { fetch },
      undefined,
      {
        enablePodBootstrap: true,
        podLayoutManager: { ensureDefaultLayoutAndPolicies },
      }
    )

    await expect(
      manager.writeProfile('https://alice.example/', {
        displayName: '',
        bio: 'Hi',
        interests: ['solid'],
        isNsfw: false,
      })
    ).rejects.toThrow('Public profile contract validation failed')

    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledTimes(1)
    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledWith('https://alice.example/', expect.any(Object))
  })
})

describe('ProfileManager.readProfile', () => {
  it('reads profile data when the dataset subject is proxy-shaped', async () => {
    const turtle = `
@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<https://nodezero-social-staging-testnet-provisioner.azurewebsites.net/v1/pod-proxy/qaprof/profile/card#me>
  a foaf:Person ;
  vcard:fn "Proxy Alice" ;
  vcard:note "Saved through proxy" .
`

    const fetch = jestGlobal.fn().mockResolvedValue(
      new Response(turtle, {
        status: 200,
        headers: { 'Content-Type': 'text/turtle' },
      })
    )

    const manager = new ProfileManager({ fetch })
    const profile = await manager.readProfile('https://qaprof.example/profile/card#me')

    expect(profile).not.toBeNull()
    expect(profile?.displayName).toBe('Proxy Alice')
    expect(profile?.bio).toBe('Saved through proxy')
  })
})

describe('SocialGraph.addConnection', () => {
  it('rejects invalid WebID values before writing', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: true })
    const graph = new SocialGraph({ fetch })

    await expect(
      graph.addConnection('https://alice.example/', 'https://bob.example/profile/card')
    ).rejects.toThrow('Social Graph contract validation failed')

    expect(fetch).toHaveBeenCalledTimes(0)
  })

  it('runs pod bootstrap before connection write when enabled', async () => {
    const ensureDefaultLayoutAndPolicies = jestGlobal.fn().mockResolvedValue(undefined)
    const fetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 200 }))
    const graph = new SocialGraph(
      { fetch },
      {
        enablePodBootstrap: true,
        podLayoutManager: { ensureDefaultLayoutAndPolicies },
      }
    )

    await graph.addConnection('https://alice.example/', 'https://bob.example/profile/card#me')

    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledTimes(1)
    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledWith('https://alice.example/', expect.any(Object))
  })
})