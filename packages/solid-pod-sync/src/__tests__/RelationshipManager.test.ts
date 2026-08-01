import { RelationshipManager } from '../RelationshipManager.js'

const jestGlobal = import.meta.jest
const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const timestamp = '2026-08-01T12:00:00.000Z'
const activityId = 'https://alice.example/social/outbox/follow-bob'

function responseWithUrl(body: string, url: string): Response {
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

describe('RelationshipManager', () => {
  it('creates an outgoing pending relationship in the owner Pod', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const manager = new RelationshipManager({ fetch })

    await expect(manager.transitionRelationship('https://alice.example/', {
      peerWebId: bob,
      to: 'outgoing-pending',
      updatedAt: timestamp,
      activityId,
    })).resolves.toEqual({
      version: 1,
      ownerWebId: alice,
      peerWebId: bob,
      state: 'outgoing-pending',
      updatedAt: timestamp,
      activityId,
    })

    const body = String(fetch.mock.calls[2]?.[1]?.body ?? '')
    expect(body).toContain('outgoing-pending')
    expect(body).toContain(encodeURIComponent(bob))
  })

  it('accepts a pending relationship and rejects a direct none-to-accepted transition', async () => {
    const existing = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://alice.example/social/relationships/index#peer-${encodeURIComponent(bob)}>
        a nz:Relationship ;
        nz:version 1 ;
        nz:ownerWebId <${alice}> ;
        nz:peerWebId <${bob}> ;
        nz:relationshipState "incoming-pending" ;
        nz:updatedAt "${timestamp}" .
    `
    const datasetUrl = 'https://alice.example/social/relationships/index'
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(responseWithUrl(existing, datasetUrl))
      .mockResolvedValueOnce(responseWithUrl(existing, datasetUrl))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new RelationshipManager({ fetch })

    await expect(manager.transitionRelationship('https://alice.example/', {
      peerWebId: bob,
      to: 'accepted',
      updatedAt: '2026-08-01T12:05:00.000Z',
      activityId: 'https://bob.example/social/outbox/accept-alice',
    })).resolves.toMatchObject({ state: 'accepted' })

    const missingFetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 404 }))
    await expect(new RelationshipManager({ fetch: missingFetch }).transitionRelationship(
      'https://alice.example/',
      { peerWebId: bob, to: 'accepted', updatedAt: timestamp }
    )).rejects.toThrow('Invalid relationship transition: none -> accepted')
  })

  it('imports legacy connections idempotently without fabricated activity IDs', async () => {
    const existing = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://alice.example/social/relationships/index#peer-${encodeURIComponent(bob)}>
        a nz:Relationship ; nz:version 1 ; nz:ownerWebId <${alice}> ;
        nz:peerWebId <${bob}> ; nz:relationshipState "legacy-connected" ;
        nz:updatedAt "${timestamp}" .
    `
    const datasetUrl = 'https://alice.example/social/relationships/index'
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      .mockResolvedValueOnce(responseWithUrl(existing, datasetUrl))
    const manager = new RelationshipManager({ fetch })

    const imported = await manager.importLegacyConnection('https://alice.example/', bob, timestamp)
    expect(imported).toEqual({
      version: 1,
      ownerWebId: alice,
      peerWebId: bob,
      state: 'legacy-connected',
      updatedAt: timestamp,
    })
    await expect(manager.importLegacyConnection('https://alice.example/', bob, timestamp))
      .resolves.toEqual(imported)
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('lists only relationship Things in stable peer order', async () => {
    const carol = 'https://carol.example/profile/card#me'
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://alice.example/social/relationships/index#peer-${encodeURIComponent(carol)}>
        a nz:Relationship ; nz:version 1 ; nz:ownerWebId <${alice}> ;
        nz:peerWebId <${carol}> ; nz:relationshipState "accepted" ; nz:updatedAt "${timestamp}" .
      <https://alice.example/social/relationships/index#peer-${encodeURIComponent(bob)}>
        a nz:Relationship ; nz:version 1 ; nz:ownerWebId <${alice}> ;
        nz:peerWebId <${bob}> ; nz:relationshipState "legacy-connected" ; nz:updatedAt "${timestamp}" .
      <https://alice.example/social/relationships/index#metadata> nz:note "ignore me" .
    `
    const fetch = jestGlobal.fn().mockResolvedValue(
      responseWithUrl(body, 'https://alice.example/social/relationships/index')
    )
    const manager = new RelationshipManager({ fetch })

    const records = await manager.listRelationships('https://alice.example/')
    expect(records.map((record) => record.peerWebId)).toEqual([bob, carol])
  })

  it('preserves unknown predicates when updating a relationship', async () => {
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      @prefix ex: <https://example.test/ns#> .
      <https://alice.example/social/relationships/index#peer-${encodeURIComponent(bob)}>
        a nz:Relationship ; nz:version 1 ; nz:ownerWebId <${alice}> ;
        nz:peerWebId <${bob}> ; nz:relationshipState "outgoing-pending" ;
        nz:updatedAt "${timestamp}" ; ex:preserved "third-party" .
    `
    const datasetUrl = 'https://alice.example/social/relationships/index'
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(responseWithUrl(body, datasetUrl))
      .mockResolvedValueOnce(responseWithUrl(body, datasetUrl))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new RelationshipManager({ fetch })

    await manager.transitionRelationship('https://alice.example/', {
      peerWebId: bob,
      to: 'cancelled',
      updatedAt: '2026-08-01T12:10:00.000Z',
    })

    const patch = String(fetch.mock.calls[2]?.[1]?.body ?? '')
    expect(patch).not.toContain('https://example.test/ns#preserved')
    expect(patch).toContain('outgoing-pending')
    expect(patch).toContain('cancelled')
  })

  it('runs Pod bootstrap before transition when enabled', async () => {
    const ensureDefaultLayoutAndPolicies = jestGlobal.fn().mockResolvedValue(undefined)
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const manager = new RelationshipManager(
      { fetch },
      { enablePodBootstrap: true, podLayoutManager: { ensureDefaultLayoutAndPolicies } }
    )

    await manager.transitionRelationship('https://alice.example/', {
      peerWebId: bob,
      to: 'outgoing-pending',
      updatedAt: timestamp,
    })

    expect(ensureDefaultLayoutAndPolicies).toHaveBeenCalledWith(
      'https://alice.example/',
      expect.any(Object)
    )
  })
})
