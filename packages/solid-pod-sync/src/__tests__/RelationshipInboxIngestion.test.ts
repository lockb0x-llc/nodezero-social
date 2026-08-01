import { RelationshipInboxIngestion } from '../RelationshipInboxIngestion.js'
import { RelationshipInboxError } from '../RelationshipInboxProcessor.js'
import type { QuarantinedRelationshipActivity } from '../RelationshipQuarantineManager.js'

const jestGlobal = import.meta.jest
const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const payload = {
  '@context': 'https://www.w3.org/ns/activitystreams',
  id: 'https://alice.example/social/outbox/follow-bob',
  type: 'Follow',
  actor: alice,
  object: bob,
  published: '2026-08-01T12:00:00.000Z',
}
const receivedAt = new Date('2026-08-01T12:01:00.000Z')

function harness(verifiedActorWebId: string | null): {
  ingestion: RelationshipInboxIngestion
  process: jest.Mock
  quarantine: jest.Mock
} {
  const process = jestGlobal.fn().mockResolvedValue({
    status: 'processed',
    activity: { version: 1, ...payload, publishedAt: payload.published },
    relationship: null,
  })
  const quarantine = jestGlobal.fn().mockImplementation(
    (_podRoot: string, record: QuarantinedRelationshipActivity) => Promise.resolve(record)
  )
  return {
    ingestion: new RelationshipInboxIngestion(
      { process },
      { quarantine },
      { verifySender: jestGlobal.fn().mockResolvedValue(verifiedActorWebId) }
    ),
    process,
    quarantine,
  }
}

describe('RelationshipInboxIngestion', () => {
  it('processes only when the verifier returns the exact claimed actor', async () => {
    const { ingestion, process, quarantine } = harness(alice)
    const result = await ingestion.ingest({
      podRoot: 'https://bob.example/',
      recipientWebId: bob,
      payload,
      sourceUrl: 'https://bob.example/social/inbox/activity-1',
      receivedAt,
    })
    expect(result.status).toBe('processed')
    expect(process).toHaveBeenCalledWith(expect.objectContaining({ verifiedActorWebId: alice }))
    expect(quarantine).not.toHaveBeenCalled()
  })

  it.each([
    [null, 'sender_unverified'],
    ['https://mallory.example/profile/card#me', 'sender_actor_mismatch'],
  ])('quarantines verifier result %s as %s without mutation', async (verifiedActor, reasonCode) => {
    const { ingestion, process, quarantine } = harness(verifiedActor)
    const result = await ingestion.ingest({
      podRoot: 'https://bob.example/', recipientWebId: bob, payload, receivedAt,
    })
    expect(result).toMatchObject({ status: 'quarantined', record: { reasonCode } })
    expect(process).not.toHaveBeenCalled()
    expect(quarantine).toHaveBeenCalledTimes(1)
  })

  it('quarantines malformed payloads before sender verification or mutation', async () => {
    const { ingestion, process } = harness(alice)
    const result = await ingestion.ingest({
      podRoot: 'https://bob.example/', recipientWebId: bob,
      payload: { type: 'Follow' }, receivedAt,
    })
    expect(result).toMatchObject({
      status: 'quarantined',
      record: { reasonCode: 'invalid_activity' },
    })
    expect(process).not.toHaveBeenCalled()
  })

  it('quarantines processor policy failures with their stable code', async () => {
    const quarantine = jestGlobal.fn().mockImplementation(
      (_podRoot: string, record: QuarantinedRelationshipActivity) => Promise.resolve(record)
    )
    const ingestion = new RelationshipInboxIngestion(
      {
        process: jestGlobal.fn().mockRejectedValue(
          new RelationshipInboxError('Actor is blocked.', 'actor_blocked')
        ),
      },
      { quarantine },
      { verifySender: jestGlobal.fn().mockResolvedValue(alice) }
    )
    const result = await ingestion.ingest({
      podRoot: 'https://bob.example/', recipientWebId: bob, payload, receivedAt,
    })
    expect(result).toMatchObject({
      status: 'quarantined',
      record: { reasonCode: 'actor_blocked' },
    })
  })

  it('propagates transient processor storage failures without quarantine', async () => {
    const quarantine = jestGlobal.fn()
    const storageError = new Error('temporary replay store failure')
    const ingestion = new RelationshipInboxIngestion(
      { process: jestGlobal.fn().mockRejectedValue(storageError) },
      { quarantine },
      { verifySender: jestGlobal.fn().mockResolvedValue(alice) }
    )

    await expect(ingestion.ingest({
      podRoot: 'https://bob.example/', recipientWebId: bob, payload, receivedAt,
    })).rejects.toBe(storageError)
    expect(quarantine).not.toHaveBeenCalled()
  })

  it('propagates retryable sender verification failures without quarantine', async () => {
    const quarantine = jestGlobal.fn()
    const retryableError = Object.assign(new Error('temporarily unavailable'), { retryable: true })
    const ingestion = new RelationshipInboxIngestion(
      { process: jestGlobal.fn() },
      { quarantine },
      { verifySender: jestGlobal.fn().mockRejectedValue(retryableError) }
    )

    await expect(ingestion.ingest({
      podRoot: 'https://bob.example/', recipientWebId: bob, payload, receivedAt,
    })).rejects.toBe(retryableError)
    expect(quarantine).not.toHaveBeenCalled()
  })
})
