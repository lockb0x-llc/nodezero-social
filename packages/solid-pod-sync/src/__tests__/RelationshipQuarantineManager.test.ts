import { RelationshipQuarantineManager } from '../RelationshipQuarantineManager.js'

const jestGlobal = import.meta.jest
const record = {
  version: 1 as const,
  quarantineId: 'entry-1',
  receivedAt: '2026-08-01T12:00:00.000Z',
  reasonCode: 'sender_unverified',
  payloadJson: JSON.stringify({ type: 'Follow' }),
  activityId: 'https://alice.example/social/outbox/follow-bob',
  claimedActorWebId: 'https://alice.example/profile/card#me',
  sourceUrl: 'https://bob.example/social/inbox/activity-1',
}

describe('RelationshipQuarantineManager', () => {
  it('persists bounded quarantine metadata in the private ledger', async () => {
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const manager = new RelationshipQuarantineManager({ fetch })

    await expect(manager.quarantine('https://bob.example/', record)).resolves.toEqual(record)
    const patch = String(fetch.mock.calls[1]?.[1]?.body)
    expect(patch).toContain('sender_unverified')
    expect(patch).toContain('entry-1')
  })

  it('rejects oversized or malformed payloads before Pod access', async () => {
    const fetch = jestGlobal.fn()
    const manager = new RelationshipQuarantineManager({ fetch }, { maxPayloadBytes: 8 })
    await expect(manager.quarantine('https://bob.example/', record))
      .rejects.toThrow('exceeds 8 bytes')
    await expect(new RelationshipQuarantineManager({ fetch }).quarantine(
      'https://bob.example/', { ...record, payloadJson: 'not-json' }
    )).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
