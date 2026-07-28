import { DocustreamSourceManager } from '../DocustreamSourceManager.js'

const jestGlobal = import.meta.jest

const PROFILE_TURTLE = `
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
<https://alice.example/profile/card#me>
  a foaf:Person ;
  vcard:fn "Alice" ;
  foaf:name "Alice" .
`

function createPodHarness(): {
  fetch: jest.Mock
  registryWrites: Array<{ ifMatch: string | null; ifNoneMatch: string | null }>
  getRegistry: () => string | null
  getProfile: () => string
} {
  let registry: string | null = null
  let registryVersion = 0
  let profile = PROFILE_TURTLE
  const registryWrites: Array<{ ifMatch: string | null; ifNoneMatch: string | null }> = []
  const fetch = jestGlobal.fn().mockImplementation(async (rawUrl: string, init?: RequestInit) => {
    const url = String(rawUrl)
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    if (url.endsWith('/public/docustream-sources.jsonld')) {
      if (method === 'GET') {
        return registry === null
          ? new Response('', { status: 404 })
          : new Response(registry, {
              status: 200,
              headers: {
                'content-type': 'application/ld+json',
                etag: `"registry-${registryVersion}"`,
              },
            })
      }
      registryWrites.push({
        ifMatch: headers.get('if-match'),
        ifNoneMatch: headers.get('if-none-match'),
      })
      if (registry === null && headers.get('if-none-match') !== '*') {
        return new Response('', { status: 412 })
      }
      if (
        registry !== null &&
        headers.get('if-match') !== `"registry-${registryVersion}"`
      ) {
        return new Response('', { status: 412 })
      }
      registry = String(init?.body ?? '')
      registryVersion += 1
      return new Response('', { status: registryVersion === 1 ? 201 : 200 })
    }
    if (url.endsWith('/profile/card')) {
      if (method === 'GET') {
        return new Response(profile, {
          status: 200,
          headers: { 'content-type': 'text/turtle', etag: '"profile-1"' },
        })
      }
      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers: { etag: '"profile-1"' } })
      }
      if (new Headers(init?.headers).get('if-match') !== '"profile-1"') {
        return new Response('', { status: 412 })
      }
      const patch = String(init?.body ?? '')
      profile = profile
        .split('\n')
        .filter((line) => !line.includes('https://nodezero.social/ns#docustream'))
        .join('\n')
      const insertBlock = patch.slice(patch.lastIndexOf('INSERT DATA'))
      const insertedLinks = Array.from(
        insertBlock.matchAll(
          /<https:\/\/alice\.example\/profile\/card#me> <(https:\/\/nodezero\.social\/ns#docustream[^>]+)> <([^>]+)> \./g,
        ),
      )
      profile = PROFILE_TURTLE + insertedLinks
        .map((match) => `\n<https://alice.example/profile/card#me> <${match[1]}> <${match[2]}> .`)
        .join('')
      return new Response('', { status: 200 })
    }
    return new Response('', { status: 404 })
  })
  return {
    fetch,
    registryWrites,
    getRegistry: () => registry,
    getProfile: () => profile,
  }
}

describe('DocustreamSourceManager', () => {
  it('persists a source registry and verified profile links', async () => {
    const pod = createPodHarness()
    const manager = new DocustreamSourceManager({ fetch: pod.fetch })

    const saved = await manager.upsertSource('https://alice.example/', {
      url: 'https://feeds.example.com/main.xml#fragment',
      title: 'Main Feed',
    })

    expect(saved.url).toBe('https://feeds.example.com/main.xml')
    expect(pod.registryWrites).toEqual([{ ifMatch: null, ifNoneMatch: '*' }])
    expect(pod.getRegistry()).toContain('https://feeds.example.com/main.xml')
    expect(pod.getProfile()).toContain('https://nodezero.social/ns#docustreamSourceRegistry')
    expect(pod.getProfile()).toContain('https://nodezero.social/ns#docustreamContainer')
    expect(pod.getProfile()).toContain('https://nodezero.social/ns#docustreamSource')
    expect(pod.getProfile()).toContain('https://feeds.example.com/main.xml')

    const reloaded = await manager.listSources('https://alice.example/')
    expect(reloaded).toEqual([saved])
  })

  it('uses the registry ETag for updates and removes profile source links', async () => {
    const pod = createPodHarness()
    const manager = new DocustreamSourceManager({ fetch: pod.fetch })
    const source = await manager.upsertSource('https://alice.example/', {
      url: 'https://feeds.example.com/main.xml',
    })

    const disabled = await manager.setSourceEnabled('https://alice.example/', source.id, false)
    expect(disabled?.enabled).toBe(false)
    expect(pod.registryWrites[1]?.ifMatch).toBe('"registry-1"')

    await manager.removeSource('https://alice.example/', source.id)
    expect(pod.registryWrites[2]?.ifMatch).toBe('"registry-2"')
    expect(await manager.listSources('https://alice.example/')).toEqual([])
    expect(pod.getProfile()).not.toContain('https://feeds.example.com/main.xml')
  })

  it('throws on registry read failures instead of overwriting unknown state', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 401 }))
    const manager = new DocustreamSourceManager({ fetch })

    await expect(
      manager.upsertSource('https://alice.example/', {
        url: 'https://feeds.example.com/main.xml',
      }),
    ).rejects.toThrow('Failed to read DocuStream source registry: HTTP 401')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
