import { DiscoveryManifestManager } from '../DiscoveryManifestManager.js'

const jestGlobal = import.meta.jest
const alice = 'https://alice.example/profile/card#me'

const manifest = {
  version: 1 as const,
  webId: alice,
  publicationRevision: 4,
  publishedAt: '2026-08-01T12:00:00.000Z',
  expiresAt: '2026-08-08T12:00:00.000Z',
  displayName: 'Alice',
  avatarUrl: 'https://alice.example/public/avatar.png',
  publicInterests: ['solid', 'privacy'],
  capabilities: ['relationship-requests'],
  inboxUrl: 'https://alice.example/social/inbox/',
}

describe('DiscoveryManifestManager', () => {
  it('writes a validated manifest to the canonical public discovery resource', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const manager = new DiscoveryManifestManager({ fetch })

    const url = await manager.writeManifest('https://alice.example/', manifest)

    expect(url).toBe('https://alice.example/public/discovery/manifest')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]?.[0]).toBe('https://alice.example/public/discovery/manifest')
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT' })
    const writeInit = fetch.mock.calls[1]?.[1] as unknown as RequestInit
    expect(new Headers(writeInit.headers).get('if-none-match')).toBe('*')
    const body = String(fetch.mock.calls[1]?.[1]?.body ?? '')
    expect(body).toContain('https://nodezero.social/ns#DiscoveryManifest')
    expect(body).toContain('https://nodezero.social/ns#publicationRevision')
    expect(body).toContain('http://www.w3.org/ns/ldp#inbox')
    expect(body).toContain('relationship-requests')
  })

  it('removes stale unknown predicates from the public manifest Thing', async () => {
    const existing = `
      @prefix nz: <https://nodezero.social/ns#> .
      @prefix ex: <https://example.test/ns#> .
      <https://alice.example/public/discovery/manifest#manifest>
        a nz:DiscoveryManifest ;
        nz:version 1 ;
        nz:webId <https://alice.example/profile/card#me> ;
        nz:publishedAt "2026-07-01T00:00:00.000Z" ;
        nz:expiresAt "2026-07-08T00:00:00.000Z" ;
        ex:preserved "third-party" .
    `
    const existingResponse = new Response(existing, {
      status: 200,
      headers: { 'content-type': 'text/turtle', etag: '"manifest-old"' },
    })
    Object.defineProperty(existingResponse, 'url', {
      value: 'https://alice.example/public/discovery/manifest',
    })
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(existingResponse)
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new DiscoveryManifestManager({ fetch })

    await manager.writeManifest('https://alice.example/', manifest)

    const body = String(fetch.mock.calls[1]?.[1]?.body ?? '')
    const insertStart = body.indexOf('INSERT DATA')
    const deleteClause = insertStart >= 0 ? body.slice(0, insertStart) : body
    const insertClause = insertStart >= 0 ? body.slice(insertStart) : ''
    expect(deleteClause).toContain('https://example.test/ns#preserved')
    expect(deleteClause).toContain('third-party')
    expect(insertClause).not.toContain('https://example.test/ns#preserved')
    expect(insertClause).not.toContain('third-party')
    expect(body).toContain(manifest.publishedAt)
    expect(body).toContain('2026-07-01T00:00:00.000Z')
  })

  it('uses an ETag-guarded replacement when manifest PATCH is unsupported', async () => {
    const existing = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://alice.example/public/discovery/manifest#manifest>
        a nz:DiscoveryManifest ;
        nz:version 1 ;
        nz:webId <https://alice.example/profile/card#me> ;
        nz:publishedAt "2026-07-01T00:00:00.000Z" ;
        nz:expiresAt "2026-07-08T00:00:00.000Z" .
    `
    const existingResponse = new Response(existing, {
      status: 200,
      headers: { 'content-type': 'text/turtle', etag: '"manifest-1"' },
    })
    Object.defineProperty(existingResponse, 'url', {
      value: 'https://alice.example/public/discovery/manifest',
    })
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(existingResponse)
      .mockResolvedValueOnce(new Response('', { status: 501 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new DiscoveryManifestManager({ fetch })

    await manager.writeManifest('https://alice.example/', manifest)

    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'text/turtle', 'if-match': '"manifest-1"' },
    })
    expect(String(fetch.mock.calls[2]?.[1]?.body ?? '')).toContain(manifest.publishedAt)
  })

  it('rejects a manifest whose WebID does not own the target Pod namespace', async () => {
    const fetch = jestGlobal.fn()
    const manager = new DiscoveryManifestManager({ fetch })

    await expect(
      manager.writeManifest('https://alice.example/', {
        ...manifest,
        webId: 'https://mallory.example/profile/card#me',
      })
    ).rejects.toThrow('Discovery manifest owner mismatch')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads and validates the canonical manifest', async () => {
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <https://alice.example/public/discovery/manifest#manifest>
        a nz:DiscoveryManifest ;
        nz:version 1 ;
        nz:webId <https://alice.example/profile/card#me> ;
        nz:publicationRevision 4 ;
        nz:publishedAt "${manifest.publishedAt}" ;
        nz:expiresAt "${manifest.expiresAt}" ;
        nz:displayName "Alice" ;
        nz:publicInterest "solid", "privacy" ;
        nz:capability "relationship-requests" ;
        ldp:inbox <https://alice.example/social/inbox/> .
    `
    const fetch = jestGlobal.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/turtle' },
      })
    )
    const manager = new DiscoveryManifestManager({ fetch })

    await expect(manager.readManifest('https://alice.example/')).resolves.toEqual({
      version: 1,
      webId: alice,
      publicationRevision: 4,
      publishedAt: manifest.publishedAt,
      expiresAt: manifest.expiresAt,
      displayName: 'Alice',
      publicInterests: expect.arrayContaining(['solid', 'privacy']),
      capabilities: ['relationship-requests'],
      inboxUrl: 'https://alice.example/social/inbox/',
    })
  })

  it('conditionally removes only a manifest at or before the observed consent revision', async () => {
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://alice.example/public/discovery/manifest#manifest>
        a nz:DiscoveryManifest ;
        nz:version 1 ;
        nz:webId <https://alice.example/profile/card#me> ;
        nz:publicationRevision 4 ;
        nz:publishedAt "${manifest.publishedAt}" ;
        nz:expiresAt "${manifest.expiresAt}" .
    `
    const existingResponse = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/turtle', etag: '"manifest-4"' },
    })
    Object.defineProperty(existingResponse, 'url', {
      value: 'https://alice.example/public/discovery/manifest',
    })
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(existingResponse)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(
      new DiscoveryManifestManager({ fetch }).removeManifestIfUnchanged('https://alice.example/', 4)
    ).resolves.toBe(true)
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'DELETE',
      headers: { 'if-match': '"manifest-4"' },
    })
  })

  it('preserves a manifest authorized by newer consent or changed after its snapshot', async () => {
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://alice.example/public/discovery/manifest#manifest>
        a nz:DiscoveryManifest ;
        nz:version 1 ;
        nz:webId <https://alice.example/profile/card#me> ;
        nz:publicationRevision 5 ;
        nz:publishedAt "${manifest.publishedAt}" ;
        nz:expiresAt "${manifest.expiresAt}" .
    `
    const newerResponse = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/turtle', etag: '"manifest-5"' },
    })
    Object.defineProperty(newerResponse, 'url', {
      value: 'https://alice.example/public/discovery/manifest',
    })
    const newerFetch = jestGlobal.fn().mockResolvedValueOnce(newerResponse)
    await expect(
      new DiscoveryManifestManager({ fetch: newerFetch }).removeManifestIfUnchanged(
        'https://alice.example/',
        4
      )
    ).resolves.toBe(false)
    expect(newerFetch).toHaveBeenCalledTimes(1)

    const currentResponse = new Response(
      body.replace('nz:publicationRevision 5', 'nz:publicationRevision 4'),
      {
        status: 200,
        headers: { 'content-type': 'text/turtle', etag: '"manifest-4"' },
      }
    )
    Object.defineProperty(currentResponse, 'url', {
      value: 'https://alice.example/public/discovery/manifest',
    })
    const racedFetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(currentResponse)
      .mockResolvedValueOnce(new Response('', { status: 412 }))
    await expect(
      new DiscoveryManifestManager({ fetch: racedFetch }).removeManifestIfUnchanged(
        'https://alice.example/',
        4
      )
    ).resolves.toBe(false)
  })

  it('removes an ETag-stable legacy manifest during authoritative opt-out', async () => {
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://alice.example/public/discovery/manifest#manifest>
        a nz:DiscoveryManifest ;
        nz:version 1 ;
        nz:webId <https://alice.example/profile/card#me> ;
        nz:publishedAt "${manifest.publishedAt}" ;
        nz:expiresAt "${manifest.expiresAt}" .
    `
    const existingResponse = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/turtle', etag: '"legacy"' },
    })
    Object.defineProperty(existingResponse, 'url', {
      value: 'https://alice.example/public/discovery/manifest',
    })
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(existingResponse)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(
      new DiscoveryManifestManager({ fetch }).removeManifestIfUnchanged(
        'https://alice.example/',
        10
      )
    ).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('DELETE')
    const deleteInit = fetch.mock.calls[1]?.[1] as RequestInit | undefined
    expect(new Headers(deleteInit?.headers).get('if-match')).toBe('"legacy"')
  })

  it('rejects a stale writer before overwriting a newer manifest generation', async () => {
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://alice.example/public/discovery/manifest#manifest>
        a nz:DiscoveryManifest ;
        nz:version 1 ;
        nz:webId <https://alice.example/profile/card#me> ;
        nz:publicationRevision 5 ;
        nz:publishedAt "${manifest.publishedAt}" ;
        nz:expiresAt "${manifest.expiresAt}" .
    `
    const existingResponse = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/turtle', etag: '"manifest-5"' },
    })
    Object.defineProperty(existingResponse, 'url', {
      value: 'https://alice.example/public/discovery/manifest',
    })
    const fetch = jestGlobal.fn().mockResolvedValueOnce(existingResponse)

    await expect(
      new DiscoveryManifestManager({ fetch }).writeManifest('https://alice.example/', {
        ...manifest,
        publicationRevision: 4,
      })
    ).rejects.toThrow('newer discovery manifest publication')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('runs Pod bootstrap before write when enabled', async () => {
    const ensureDefaultLayoutAndPolicies = jestGlobal.fn().mockResolvedValue(undefined)
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const manager = new DiscoveryManifestManager(
      { fetch },
      { enablePodBootstrap: true, podLayoutManager: { ensureDefaultLayoutAndPolicies } }
    )

    await manager.writeManifest('https://alice.example/', manifest)

    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledWith(
      'https://alice.example/',
      expect.any(Object)
    )
  })
})
