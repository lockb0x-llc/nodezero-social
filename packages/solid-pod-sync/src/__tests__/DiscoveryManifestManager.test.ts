import { DiscoveryManifestManager } from '../DiscoveryManifestManager.js'

const jestGlobal = import.meta.jest
const alice = 'https://alice.example/profile/card#me'

const manifest = {
  version: 1 as const,
  webId: alice,
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
    const body = String(fetch.mock.calls[1]?.[1]?.body ?? '')
    expect(body).toContain('https://nodezero.social/ns#DiscoveryManifest')
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
      headers: { 'content-type': 'text/turtle' },
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

  it('rejects a manifest whose WebID does not own the target Pod namespace', async () => {
    const fetch = jestGlobal.fn()
    const manager = new DiscoveryManifestManager({ fetch })

    await expect(manager.writeManifest('https://alice.example/', {
      ...manifest,
      webId: 'https://mallory.example/profile/card#me',
    })).rejects.toThrow('Discovery manifest owner mismatch')
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
        nz:publishedAt "${manifest.publishedAt}" ;
        nz:expiresAt "${manifest.expiresAt}" ;
        nz:displayName "Alice" ;
        nz:publicInterest "solid", "privacy" ;
        nz:capability "relationship-requests" ;
        ldp:inbox <https://alice.example/social/inbox/> .
    `
    const fetch = jestGlobal.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/turtle' },
    }))
    const manager = new DiscoveryManifestManager({ fetch })

    await expect(manager.readManifest('https://alice.example/')).resolves.toEqual({
      version: 1,
      webId: alice,
      publishedAt: manifest.publishedAt,
      expiresAt: manifest.expiresAt,
      displayName: 'Alice',
      publicInterests: expect.arrayContaining(['solid', 'privacy']),
      capabilities: ['relationship-requests'],
      inboxUrl: 'https://alice.example/social/inbox/',
    })
  })

  it('deletes idempotently and reports other failures', async () => {
    const missingFetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 404 }))
    await expect(
      new DiscoveryManifestManager({ fetch: missingFetch }).removeManifest('https://alice.example/')
    ).resolves.toBeUndefined()

    const failedFetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 500 }))
    await expect(
      new DiscoveryManifestManager({ fetch: failedFetch }).removeManifest('https://alice.example/')
    ).rejects.toThrow('Failed to remove discovery manifest')
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
