import { RelationshipInboxError, RelationshipInboxProcessor } from '../RelationshipInboxProcessor.js'
import type { ProcessedActivityRecord, RelationshipRecord } from '../contracts/ConsentfulDiscoveryContract.js'

const jestGlobal = import.meta.jest
const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const followId = 'https://alice.example/social/outbox/follow-bob'
const now = new Date('2026-08-01T12:05:00.000Z')

function activity(type: 'Follow' | 'Accept' | 'Reject' | 'Undo' | 'Block', overrides = {}): Record<string, unknown> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://alice.example/social/outbox/${type.toLowerCase()}-bob`,
    type,
    actor: alice,
    object: bob,
    published: '2026-08-01T12:00:00.000Z',
    ...overrides,
  }
}

function harness(existing: RelationshipRecord | null = null, duplicate = false): {
  processor: RelationshipInboxProcessor
  transitionRelationship: jest.Mock
  recordProcessedActivity: jest.Mock
} {
  const transitionRelationship = jestGlobal.fn().mockImplementation(
    (_podRoot: string, input: { peerWebId: string; to: RelationshipRecord['state']; updatedAt: string; activityId?: string }) =>
      Promise.resolve({
        version: 1,
        ownerWebId: bob,
        peerWebId: input.peerWebId,
        state: input.to,
        updatedAt: input.updatedAt,
        ...(input.activityId ? { activityId: input.activityId } : {}),
      })
  )
  const recordProcessedActivity = jestGlobal.fn().mockImplementation(
    (_podRoot: string, record: ProcessedActivityRecord) => Promise.resolve(record)
  )
  return {
    processor: new RelationshipInboxProcessor(
      {
        getRelationship: jestGlobal.fn().mockResolvedValue(existing),
        transitionRelationship,
      },
      {
        hasProcessedActivity: jestGlobal.fn().mockResolvedValue(duplicate),
        recordProcessedActivity,
      },
      { isBlocked: jestGlobal.fn().mockResolvedValue(false) }
    ),
    transitionRelationship,
    recordProcessedActivity,
  }
}

describe('RelationshipInboxProcessor', () => {
  it('processes a verified Follow into incoming-pending and records replay state', async () => {
    const { processor, transitionRelationship, recordProcessedActivity } = harness()
    const result = await processor.process({
      podRoot: 'https://bob.example/',
      recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Follow', { id: followId }),
      now,
    })

    expect(result.status).toBe('processed')
    expect(result.relationship?.state).toBe('incoming-pending')
    expect(transitionRelationship).toHaveBeenCalledWith(
      'https://bob.example/',
      expect.objectContaining({ peerWebId: alice, to: 'incoming-pending', activityId: followId })
    )
    expect(recordProcessedActivity).toHaveBeenCalledWith(
      'https://bob.example/',
      expect.objectContaining({ activityId: followId, actorWebId: alice })
    )
  })

  it('suppresses replay before relationship mutation', async () => {
    const { processor, transitionRelationship, recordProcessedActivity } = harness(null, true)
    const result = await processor.process({
      podRoot: 'https://bob.example/',
      recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Follow', { id: followId }),
      now,
    })
    expect(result.status).toBe('duplicate')
    expect(transitionRelationship).not.toHaveBeenCalled()
    expect(recordProcessedActivity).not.toHaveBeenCalled()
  })

  it('accepts or rejects only the matching outgoing Follow', async () => {
    const pending: RelationshipRecord = {
      version: 1,
      ownerWebId: bob,
      peerWebId: alice,
      state: 'outgoing-pending',
      updatedAt: '2026-08-01T11:00:00.000Z',
      activityId: followId,
    }
    for (const [type, state] of [['Accept', 'accepted'], ['Reject', 'rejected']] as const) {
      const { processor } = harness(pending)
      const result = await processor.process({
        podRoot: 'https://bob.example/',
        recipientWebId: bob,
        verifiedActorWebId: alice,
        payload: activity(type, {
          id: `https://alice.example/social/outbox/${type.toLowerCase()}-bob`,
          object: followId,
          inReplyTo: followId,
        }),
        now,
      })
      expect(result.relationship?.state).toBe(state)
    }

    const { processor } = harness(pending)
    await expect(processor.process({
      podRoot: 'https://bob.example/',
      recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Accept', {
        object: followId,
        inReplyTo: 'https://alice.example/social/outbox/another-follow',
      }),
      now,
    })).rejects.toMatchObject({ code: 'activity_reference_mismatch' })
  })

  it('maps Undo conservatively and rejects private Block activities', async () => {
    const pending: RelationshipRecord = {
      version: 1,
      ownerWebId: bob,
      peerWebId: alice,
      state: 'incoming-pending',
      updatedAt: '2026-08-01T11:00:00.000Z',
      activityId: followId,
    }
    const { processor } = harness(pending)
    const result = await processor.process({
      podRoot: 'https://bob.example/',
      recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Undo', { object: followId, inReplyTo: followId }),
      now,
    })
    expect(result.relationship?.state).toBe('cancelled')

    await expect(harness().processor.process({
      podRoot: 'https://bob.example/',
      recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Block'),
      now,
    })).rejects.toMatchObject({ code: 'block_not_processed' })
  })

  it('requires verified sender, correct recipient, and bounded timestamps', async () => {
    const processor = harness().processor
    await expect(processor.process({
      podRoot: 'https://bob.example/', recipientWebId: bob,
      verifiedActorWebId: 'https://mallory.example/profile/card#me',
      payload: activity('Follow'), now,
    })).rejects.toMatchObject({ code: 'actor_verification_mismatch' })
    await expect(processor.process({
      podRoot: 'https://bob.example/', recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Follow', { object: 'https://carol.example/profile/card#me' }), now,
    })).rejects.toMatchObject({ code: 'recipient_mismatch' })
    await expect(processor.process({
      podRoot: 'https://bob.example/', recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Follow', { published: '2026-07-01T00:00:00.000Z' }), now,
    })).rejects.toMatchObject({ code: 'activity_expired' })
    await expect(processor.process({
      podRoot: 'https://bob.example/', recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Follow', { published: '2026-08-01T12:30:00.000Z' }), now,
    })).rejects.toMatchObject({ code: 'activity_from_future' })
  })

  it('enforces block precedence before replay checks or relationship mutation', async () => {
    const transitionRelationship = jestGlobal.fn()
    const hasProcessedActivity = jestGlobal.fn()
    const processor = new RelationshipInboxProcessor(
      {
        getRelationship: jestGlobal.fn(),
        transitionRelationship,
      },
      {
        hasProcessedActivity,
        recordProcessedActivity: jestGlobal.fn(),
      },
      { isBlocked: jestGlobal.fn().mockResolvedValue(true) }
    )

    await expect(processor.process({
      podRoot: 'https://bob.example/',
      recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Follow'),
      now,
    })).rejects.toMatchObject({ code: 'actor_blocked' })
    expect(hasProcessedActivity).not.toHaveBeenCalled()
    expect(transitionRelationship).not.toHaveBeenCalled()
  })

  it('exposes typed inbox errors', () => {
    expect(new RelationshipInboxError('test', 'code')).toMatchObject({ code: 'code' })
  })
})
