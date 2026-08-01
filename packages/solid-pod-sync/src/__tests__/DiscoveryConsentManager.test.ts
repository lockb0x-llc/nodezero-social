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
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const manager = new DiscoveryConsentManager({ fetch })
    const consent = await manager.updateConsent(
      'https://alice.example/',
      { inboundContactRequests: true },
      '2026-08-01T12:00:00.000Z'
    )
    expect(consent.inboundContactRequests).toBe(true)
    expect(consent.publicListing).toBe(false)
    expect(String(fetch.mock.calls[2]?.[1]?.body)).toContain('inboundContactRequests')
  })
})
