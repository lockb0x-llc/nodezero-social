import { DiscoveryConsentManager } from '../DiscoveryConsentManager.js'

const jestGlobal = import.meta.jest
const alice = 'https://alice.example/profile/card#me'

describe('DiscoveryConsentManager', () => {
  it('returns all consent dimensions false when no record exists', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 404 }))
    const consent = await new DiscoveryConsentManager({ fetch }).readConsent(
      'https://alice.example/',
      new Date('2026-08-01T12:00:00.000Z')
    )
    expect(consent).toEqual({
      version: 1,
      revision: 0,
      ownerWebId: alice,
      publicListing: false,
      publicIndexing: false,
      nearbyPresence: false,
      inboundContactRequests: false,
      localBroadcasts: false,
      updatedAt: '2026-08-01T12:00:00.000Z',
    })
  })

  it('updates only explicitly patched consent dimensions', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const manager = new DiscoveryConsentManager({ fetch })
    const consent = await manager.updateConsent(
      'https://alice.example/',
      { inboundContactRequests: true },
      '2026-08-01T12:00:00.000Z'
    )
    expect(consent.inboundContactRequests).toBe(true)
    expect(consent.revision).toBe(1)
    expect(consent.publicationRevision).toBeUndefined()
    expect(consent.publicationUpdatedAt).toBeUndefined()
    expect(consent.publicListing).toBe(false)
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({ 'if-none-match': '*' })
    expect(String(fetch.mock.calls[1]?.[1]?.body)).toContain('inboundContactRequests')
  })

  it('retries ETag conflicts and patches only requested dimensions', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(consentResponse(4, '"consent-4"', false))
      .mockResolvedValueOnce(new Response('', { status: 412 }))
      .mockResolvedValueOnce(consentResponse(5, '"consent-5"', true))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const consent = await new DiscoveryConsentManager({ fetch }).updateConsent(
      'https://alice.example/',
      { inboundContactRequests: true },
      '2026-08-01T12:00:00.000Z'
    )
    expect(consent.revision).toBe(6)
    expect(consent.nearbyPresence).toBe(true)
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({ 'if-match': '"consent-4"' })
    expect(fetch.mock.calls[3]?.[1]?.headers).toMatchObject({ 'if-match': '"consent-5"' })
    const patch = String(fetch.mock.calls[3]?.[1]?.body)
    expect(patch).toContain('inboundContactRequests')
    expect(patch).not.toContain('publicListing')
  })

  it('falls back to an ETag-guarded replacement when SPARQL PATCH is unsupported', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(consentResponse(4, '"consent-4"', true))
      .mockResolvedValueOnce(new Response('', { status: 501 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const consent = await new DiscoveryConsentManager({ fetch }).updateConsent(
      'https://alice.example/',
      { publicListing: true },
      '2026-08-01T12:00:00.000Z',
      { publicListing: false }
    )
    expect(consent.publicListing).toBe(true)
    expect(consent.publicationRevision).toBe(1)
    expect(consent.publicationUpdatedAt).toBe('2026-08-01T12:00:00.000Z')
    expect(consent.nearbyPresence).toBe(true)
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'PATCH',
      headers: { 'if-match': '"consent-4"' },
    })
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'text/turtle', 'if-match': '"consent-4"' },
    })
    const replacement = String(fetch.mock.calls[2]?.[1]?.body)
    expect(replacement).toContain('publicListing> true')
    expect(replacement).toContain('publicationRevision> 1')
    expect(replacement).toContain('nearbyPresence> true')
  })

  it('rejects a stale field precondition before overwriting another device', async () => {
    const fetch = jestGlobal.fn().mockResolvedValueOnce(consentResponse(5, '"consent-5"', false))
    const manager = new DiscoveryConsentManager({ fetch })
    await expect(
      manager.updateConsent(
        'https://alice.example/',
        { publicListing: true },
        '2026-08-01T12:00:00.000Z',
        { publicListing: true }
      )
    ).rejects.toThrow('changed concurrently')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reserves one monotonic publication generation and rejects a stale reservation', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(consentResponse(4, '"consent-4"', false, 2))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(consentResponse(5, '"consent-5"', false, 3))
    const manager = new DiscoveryConsentManager({ fetch })

    const reserved = await manager.reservePublicationRevision(
      'https://alice.example/',
      2,
      '2026-08-01T12:00:00.000Z'
    )
    expect(reserved.publicationRevision).toBe(3)
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({ 'if-match': '"consent-4"' })
    await expect(
      manager.reservePublicationRevision(
        'https://alice.example/',
        2,
        '2026-08-01T12:01:00.000Z'
      )
    ).rejects.toThrow('publication changed concurrently')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('treats a legacy expected generation as zero after an ETag conflict', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(consentResponse(1, '"legacy"', false))
      .mockResolvedValueOnce(new Response('', { status: 412 }))
      .mockResolvedValueOnce(consentResponse(2, '"newer"', false, 1))
    const manager = new DiscoveryConsentManager({ fetch })

    await expect(
      manager.reservePublicationRevision(
        'https://alice.example/',
        undefined,
        '2026-08-01T12:00:00.000Z'
      )
    ).rejects.toThrow('publication changed concurrently')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('rebases a reservation when only the generation changed', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(consentResponse(5, '"current"', true, 4))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const manager = new DiscoveryConsentManager({ fetch })

    const reserved = await manager.reservePublicationRevision(
      'https://alice.example/',
      3,
      '2026-08-01T12:00:00.000Z',
      { publicListing: false, publicIndexing: false }
    )

    expect(reserved.publicationRevision).toBe(5)
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('cache-control')).toBe('no-cache')
  })

  it('rejects rebasing when the public intent changed', async () => {
    const fetch = jestGlobal.fn().mockResolvedValueOnce(consentResponse(5, '"current"', false, 4))
    const manager = new DiscoveryConsentManager({ fetch })

    await expect(
      manager.reservePublicationRevision(
        'https://alice.example/',
        3,
        '2026-08-01T12:00:00.000Z',
        { publicListing: true, publicIndexing: false }
      )
    ).rejects.toThrow('publication changed concurrently')
  })

  it('rejects rebasing from an expected generation ahead of Pod authority', async () => {
    const fetch = jestGlobal.fn().mockResolvedValueOnce(consentResponse(4, '"current"', false, 3))
    const manager = new DiscoveryConsentManager({ fetch })

    await expect(
      manager.reservePublicationRevision(
        'https://alice.example/',
        4,
        '2026-08-01T12:00:00.000Z',
        { publicListing: false, publicIndexing: false }
      )
    ).rejects.toThrow('publication changed concurrently')
  })

  it('rebases after a 412 when the winning writer kept the same public intent', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(consentResponse(4, '"first"', false, 3))
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(consentResponse(5, '"winner"', false, 4))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const manager = new DiscoveryConsentManager({ fetch })

    const reserved = await manager.reservePublicationRevision(
      'https://alice.example/',
      3,
      '2026-08-01T12:00:00.000Z',
      { publicListing: false, publicIndexing: false }
    )

    expect(reserved.publicationRevision).toBe(5)
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})

function consentResponse(
  revision: number,
  etag: string,
  nearbyPresence: boolean,
  publicationRevision?: number
): Response {
  const thing = 'https://alice.example/social/consent/discovery#consent'
  const predicate = 'https://nodezero.social/ns#'
  return new Response(
    [
      `<${thing}> a <${predicate}DiscoveryConsent>;`,
      `  <${predicate}version> 1;`,
      `  <${predicate}revision> ${revision};`,
      ...(publicationRevision === undefined
        ? []
        : [
            `  <${predicate}publicationRevision> ${publicationRevision};`,
            `  <${predicate}publicationUpdatedAt> "2026-08-01T11:00:00.000Z";`,
          ]),
      `  <${predicate}ownerWebId> <${alice}>;`,
      `  <${predicate}publicListing> false;`,
      `  <${predicate}publicIndexing> false;`,
      `  <${predicate}nearbyPresence> ${nearbyPresence};`,
      `  <${predicate}inboundContactRequests> false;`,
      `  <${predicate}localBroadcasts> false;`,
      `  <${predicate}updatedAt> "2026-08-01T11:00:00.000Z".`,
    ].join('\n'),
    { status: 200, headers: { 'content-type': 'text/turtle', etag } }
  )
}
