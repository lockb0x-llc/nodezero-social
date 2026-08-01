import {
  WebIdDiscoveryClient,
  parseLinkHeader,
} from '../WebIdDiscoveryClient.js'

const jestGlobal = import.meta.jest
const webId = 'https://alice.example/profile/card#me'
const profileUrl = 'https://alice.example/profile/card'
const typeIndexUrl = 'https://alice.example/settings/publicTypeIndex.ttl'
const manifestUrl = 'https://alice.example/public/discovery/manifest'

function responseWithUrl(body: string, url: string, link?: string): Response {
  const headers = new Headers({ 'content-type': 'text/turtle' })
  if (link) headers.set('link', link)
  const response = new Response(body, { status: 200, headers })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

describe('WebIdDiscoveryClient', () => {
  it('discovers inbox, Type Index, and manifest from RDF resources', async () => {
    const profile = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${webId}> ldp:inbox <https://alice.example/social/inbox/> ;
        solid:publicTypeIndex <${typeIndexUrl}> .
    `
    const typeIndex = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${typeIndexUrl}#discovery> a solid:TypeRegistration ;
        solid:forClass <https://nodezero.social/ns#DiscoveryManifest> ;
        solid:instance <${manifestUrl}> .
    `
    const publicFetch = jestGlobal.fn().mockImplementation((input: unknown) => {
      const url = String(input)
      return Promise.resolve(
        url === profileUrl
          ? responseWithUrl(profile, profileUrl)
          : responseWithUrl(typeIndex, typeIndexUrl)
      )
    })

    await expect(new WebIdDiscoveryClient({ publicFetch }).discover(webId)).resolves.toEqual({
      webId,
      profileUrl,
      inboxUrl: 'https://alice.example/social/inbox/',
      publicTypeIndexUrl: typeIndexUrl,
      discoveryManifestUrl: manifestUrl,
      authenticated: false,
    })
  })

  it('falls back to HTTP Link relations and resolves relative targets', async () => {
    const profile = `<${webId}> a <http://xmlns.com/foaf/0.1/Person> .`
    const typeIndex = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${typeIndexUrl}#discovery> a solid:TypeRegistration ;
        solid:forClass <https://nodezero.social/ns#DiscoveryManifest> ;
        solid:instance <${manifestUrl}> .
    `
    const links = '</social/inbox/>; rel="http://www.w3.org/ns/ldp#inbox", ' +
      '</settings/publicTypeIndex.ttl>; rel="http://www.w3.org/ns/solid/terms#publicTypeIndex"'
    const publicFetch = jestGlobal.fn().mockImplementation((input: unknown) => {
      const url = String(input)
      return Promise.resolve(
        url === profileUrl
          ? responseWithUrl(profile, profileUrl, links)
          : responseWithUrl(typeIndex, typeIndexUrl)
      )
    })

    const result = await new WebIdDiscoveryClient({ publicFetch }).discover(webId)
    expect(result.inboxUrl).toBe('https://alice.example/social/inbox/')
    expect(result.publicTypeIndexUrl).toBe(typeIndexUrl)
  })

  it('returns null capabilities when optional links are absent', async () => {
    const publicFetch = jestGlobal.fn().mockResolvedValue(
      responseWithUrl(`<${webId}> a <http://xmlns.com/foaf/0.1/Person> .`, profileUrl)
    )
    await expect(new WebIdDiscoveryClient({ publicFetch }).discover(webId)).resolves.toMatchObject({
      inboxUrl: null,
      publicTypeIndexUrl: null,
      discoveryManifestUrl: null,
      authenticated: false,
    })
  })

  it('rejects non-https or fragmentless WebIDs before fetch', async () => {
    const publicFetch = jestGlobal.fn()
    const client = new WebIdDiscoveryClient({ publicFetch })
    await expect(client.discover('http://alice.example/profile/card#me')).rejects.toThrow('https URL')
    await expect(client.discover('https://alice.example/profile/card')).rejects.toThrow('fragment identifier')
    expect(publicFetch).not.toHaveBeenCalled()
  })
})

describe('parseLinkHeader', () => {
  it('supports multiple relation tokens and ignores malformed targets', () => {
    const links = parseLinkHeader(
      '</inbox/>; rel="alternate http://www.w3.org/ns/ldp#inbox", <http://[::1>; rel="bad"',
      profileUrl
    )
    expect(links.get('alternate')).toBe('https://alice.example/inbox/')
    expect(links.get('http://www.w3.org/ns/ldp#inbox')).toBe('https://alice.example/inbox/')
    expect(links.has('bad')).toBe(false)
  })
})
