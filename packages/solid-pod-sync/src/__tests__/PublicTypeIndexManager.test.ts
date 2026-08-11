import { DISCOVERY_MANIFEST_CLASS, PublicTypeIndexManager } from '../PublicTypeIndexManager.js'

const jestGlobal = import.meta.jest
const webId = 'https://alice.example/profile/card#me'
const indexUrl = 'https://alice.example/settings/publicTypeIndex.ttl'
const manifestUrl = 'https://alice.example/public/discovery/manifest'

function responseWithUrl(body: string, url: string): Response {
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle', etag: '"index-1"' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

describe('PublicTypeIndexManager', () => {
  it('discovers the public Type Index from the owner WebID profile', async () => {
    const profile = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${webId}> solid:publicTypeIndex <${indexUrl}> .
    `
    const fetch = jestGlobal
      .fn()
      .mockResolvedValue(responseWithUrl(profile, 'https://alice.example/profile/card'))
    const manager = new PublicTypeIndexManager({ fetch })

    await expect(manager.discoverPublicTypeIndex(webId)).resolves.toBe(indexUrl)
  })

  it('adds a public Type Index pointer to a fresh owner profile', async () => {
    const profile = `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <${webId}> a foaf:Person ; foaf:name "Alice" .
    `
    const profileResponse = new Response(profile, {
      status: 200,
      headers: { 'content-type': 'text/turtle', etag: '"profile-1"' },
    })
    Object.defineProperty(profileResponse, 'url', {
      value: 'https://alice.example/profile/card',
    })
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(profileResponse)
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new PublicTypeIndexManager({ fetch })

    await expect(
      manager.ensurePublicTypeIndex('https://alice.example/', webId, 4)
    ).resolves.toBe('https://alice.example/public/discovery/type-index')

    const patch = String(fetch.mock.calls[1]?.[1]?.body ?? '')
    const updateInit = fetch.mock.calls[1]?.[1] as RequestInit | undefined
    expect(new Headers(updateInit?.headers).get('x-nodezero-publication-revision')).toBe('4')
    expect(patch).toContain('http://www.w3.org/ns/solid/terms#publicTypeIndex')
    expect(patch).toContain('https://alice.example/public/discovery/type-index')
    expect(patch).not.toContain('foaf:name')
  })

  it('creates the discovery registration in a missing public Type Index', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const manager = new PublicTypeIndexManager({ fetch })

    await expect(
      manager.ensureDiscoveryManifestRegistration(
        'https://alice.example/',
        indexUrl,
        manifestUrl,
        4
      )
    ).resolves.toBe(`${indexUrl}#nodezero-discovery-manifest`)

    const body = String(fetch.mock.calls[1]?.[1]?.body ?? '')
    expect(body).toContain(DISCOVERY_MANIFEST_CLASS)
    expect(body).toContain(manifestUrl)
    expect(body).toContain('https://nodezero.social/ns#publicationRevision')
    expect(body).toContain('http://www.w3.org/ns/solid/terms#ListedDocument')
  })

  it('preserves unrelated registrations while replacing the NodeZero registration', async () => {
    const existing = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix ex: <https://example.test/ns#> .
      <${indexUrl}> a solid:TypeIndex, solid:ListedDocument .
      <${indexUrl}#bookmarks> a solid:TypeRegistration ;
        solid:forClass <https://example.test/ns#Bookmark> ;
        solid:instance <https://alice.example/public/bookmarks> .
      <${indexUrl}#nodezero-discovery-manifest> a solid:TypeRegistration ;
        solid:forClass <${DISCOVERY_MANIFEST_CLASS}> ;
        solid:instance <https://alice.example/public/old-manifest> ;
        ex:preserved "third-party" .
    `
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(responseWithUrl(existing, indexUrl))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new PublicTypeIndexManager({ fetch })

    await manager.ensureDiscoveryManifestRegistration(
      'https://alice.example/',
      indexUrl,
      manifestUrl
    )

    const patch = String(fetch.mock.calls[1]?.[1]?.body ?? '')
    expect(patch).not.toContain('https://example.test/ns#Bookmark')
    expect(patch).not.toContain('https://example.test/ns#preserved')
    expect(patch).toContain('https://alice.example/public/old-manifest')
    expect(patch).toContain(manifestUrl)
  })

  it('uses an ETag-guarded replacement when Type Index PATCH is unsupported', async () => {
    const existing = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${indexUrl}> a solid:TypeIndex, solid:ListedDocument .
      <${indexUrl}#bookmarks> a solid:TypeRegistration ;
        solid:forClass <https://example.test/ns#Bookmark> ;
        solid:instance <https://alice.example/public/bookmarks> .
    `
    const existingResponse = new Response(existing, {
      status: 200,
      headers: { 'content-type': 'text/turtle', etag: '"index-1"' },
    })
    Object.defineProperty(existingResponse, 'url', { value: indexUrl })
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(existingResponse)
      .mockResolvedValueOnce(new Response('', { status: 415 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new PublicTypeIndexManager({ fetch })

    await manager.ensureDiscoveryManifestRegistration(
      'https://alice.example/',
      indexUrl,
      manifestUrl
    )

    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'text/turtle', 'if-match': '"index-1"' },
    })
    const replacement = String(fetch.mock.calls[2]?.[1]?.body ?? '')
    expect(replacement).toContain('Bookmark')
    expect(replacement).toContain(DISCOVERY_MANIFEST_CLASS)
  })

  it('rejects Type Index and manifest resources outside the owner Pod namespace', async () => {
    const fetch = jestGlobal.fn()
    const manager = new PublicTypeIndexManager({ fetch })

    await expect(
      manager.ensureDiscoveryManifestRegistration(
        'https://alice.example/',
        'https://mallory.example/publicTypeIndex.ttl',
        manifestUrl
      )
    ).rejects.toThrow('publicTypeIndexUrl must remain inside the owner Pod namespace')
    await expect(
      manager.ensureDiscoveryManifestRegistration(
        'https://alice.example/',
        indexUrl,
        'https://mallory.example/manifest'
      )
    ).rejects.toThrow('discoveryManifestUrl must remain inside the owner Pod namespace')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('removes only the NodeZero discovery registration and is idempotent', async () => {
    const existing = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${indexUrl}#bookmarks> a solid:TypeRegistration ;
        solid:forClass <https://example.test/ns#Bookmark> ;
        solid:instance <https://alice.example/public/bookmarks> .
      <${indexUrl}#nodezero-discovery-manifest> a solid:TypeRegistration ;
        solid:forClass <${DISCOVERY_MANIFEST_CLASS}> ;
        solid:instance <${manifestUrl}> .
    `
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(responseWithUrl(existing, indexUrl))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(
        responseWithUrl(
          `
        @prefix solid: <http://www.w3.org/ns/solid/terms#> .
        <${indexUrl}#bookmarks> a solid:TypeRegistration ;
          solid:forClass <https://example.test/ns#Bookmark> ;
          solid:instance <https://alice.example/public/bookmarks> .
      `,
          indexUrl
        )
      )
    const manager = new PublicTypeIndexManager({ fetch })

    await manager.removeDiscoveryManifestRegistration('https://alice.example/', indexUrl)
    await manager.removeDiscoveryManifestRegistration('https://alice.example/', indexUrl)

    const patch = String(fetch.mock.calls[1]?.[1]?.body ?? '')
    expect(patch).toContain('nodezero-discovery-manifest')
    expect(patch).not.toContain('Bookmark')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('conditionally removes only registrations at or before the observed generation', async () => {
    const existing = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix nz: <https://nodezero.social/ns#> .
      <${indexUrl}#nodezero-discovery-manifest> a solid:TypeRegistration ;
        solid:forClass <${DISCOVERY_MANIFEST_CLASS}> ;
        solid:instance <${manifestUrl}> ;
        nz:publicationRevision 4 .
    `
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(responseWithUrl(existing, indexUrl))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new PublicTypeIndexManager({ fetch })

    await expect(
      manager.removeDiscoveryManifestRegistration('https://alice.example/', indexUrl, 4)
    ).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('preserves newer registrations and removes legacy registrations during opt-out', async () => {
    const newer = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix nz: <https://nodezero.social/ns#> .
      <${indexUrl}#nodezero-discovery-manifest> a solid:TypeRegistration ;
        solid:forClass <${DISCOVERY_MANIFEST_CLASS}> ;
        solid:instance <${manifestUrl}> ;
        nz:publicationRevision 5 .
    `
    const newerFetch = jestGlobal.fn().mockResolvedValueOnce(responseWithUrl(newer, indexUrl))
    await expect(
      new PublicTypeIndexManager({ fetch: newerFetch }).removeDiscoveryManifestRegistration(
        'https://alice.example/',
        indexUrl,
        4
      )
    ).resolves.toBe(false)
    expect(newerFetch).toHaveBeenCalledTimes(1)

    const legacy = newer.replace(' ;\n        nz:publicationRevision 5', '')
    const legacyFetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(responseWithUrl(legacy, indexUrl))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    await expect(
      new PublicTypeIndexManager({ fetch: legacyFetch }).removeDiscoveryManifestRegistration(
        'https://alice.example/',
        indexUrl,
        10
      )
    ).resolves.toBe(true)
    expect(legacyFetch).toHaveBeenCalledTimes(2)
    const updateInit = legacyFetch.mock.calls[1]?.[1] as RequestInit | undefined
    expect(new Headers(updateInit?.headers).get('if-match')).toBe('"index-1"')
  })

  it('rejects a stale writer before downgrading a newer registration generation', async () => {
    const existing = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix nz: <https://nodezero.social/ns#> .
      <${indexUrl}#nodezero-discovery-manifest> a solid:TypeRegistration ;
        solid:forClass <${DISCOVERY_MANIFEST_CLASS}> ;
        solid:instance <${manifestUrl}> ;
        nz:publicationRevision 5 .
    `
    const fetch = jestGlobal.fn().mockResolvedValueOnce(responseWithUrl(existing, indexUrl))

    await expect(
      new PublicTypeIndexManager({ fetch }).ensureDiscoveryManifestRegistration(
        'https://alice.example/',
        indexUrl,
        manifestUrl,
        4
      )
    ).rejects.toThrow('newer discovery Type Index registration')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('lists valid registrations in stable class order', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${indexUrl}> a solid:TypeIndex, solid:ListedDocument .
      <${indexUrl}#discovery> a solid:TypeRegistration ;
        solid:forClass <${DISCOVERY_MANIFEST_CLASS}> ; solid:instance <${manifestUrl}> .
      <${indexUrl}#bookmarks> a solid:TypeRegistration ;
        solid:forClass <https://example.test/ns#Bookmark> ;
        solid:instance <https://alice.example/public/bookmarks> .
    `
    const fetch = jestGlobal.fn().mockResolvedValue(responseWithUrl(body, indexUrl))
    const manager = new PublicTypeIndexManager({ fetch })

    await expect(manager.listRegistrations(indexUrl)).resolves.toEqual([
      {
        forClass: 'https://example.test/ns#Bookmark',
        instance: 'https://alice.example/public/bookmarks',
      },
      { forClass: DISCOVERY_MANIFEST_CLASS, instance: manifestUrl },
    ])
  })

  it('rejects a registration graph that is not a declared public Type Index', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${indexUrl}#discovery> a solid:TypeRegistration ;
        solid:forClass <${DISCOVERY_MANIFEST_CLASS}> ; solid:instance <${manifestUrl}> .
    `
    const manager = new PublicTypeIndexManager({
      fetch: jestGlobal.fn().mockResolvedValue(responseWithUrl(body, indexUrl)),
    })

    await expect(
      manager.listRegistrations(indexUrl, { requirePublicIndexTypes: true })
    ).rejects.toThrow('required Solid types')
  })
})
