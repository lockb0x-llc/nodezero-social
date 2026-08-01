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
  commitProcessedActivity: jest.Mock
  releaseProcessedActivity: jest.Mock
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
  const commitProcessedActivity = jestGlobal.fn().mockImplementation(
    (_podRoot: string, record: ProcessedActivityRecord) => Promise.resolve(record)
  )
  const releaseProcessedActivity = jestGlobal.fn().mockResolvedValue(undefined)
  const lease = { activityId: followId, etag: '"lease-1"' }
  return {
    processor: new RelationshipInboxProcessor(
      {
        getRelationship: jestGlobal.fn().mockResolvedValue(existing),
        transitionRelationship,
      },
      {
        reserveProcessedActivity: jestGlobal.fn().mockResolvedValue(
          duplicate ? { status: 'duplicate' } : { status: 'acquired', lease }
        ),
        commitProcessedActivity,
        releaseProcessedActivity,
      },
      { isBlocked: jestGlobal.fn().mockResolvedValue(false) }
    ),
    transitionRelationship,
    commitProcessedActivity,
    releaseProcessedActivity,
  }
}

describe('RelationshipInboxProcessor', () => {
  it('processes a verified Follow into incoming-pending and records replay state', async () => {
    const { processor, transitionRelationship, commitProcessedActivity } = harness()
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
    expect(commitProcessedActivity).toHaveBeenCalledWith(
      'https://bob.example/',
      expect.objectContaining({ activityId: followId, actorWebId: alice }),
      { activityId: followId, etag: '"lease-1"' }
    )
  })

  it('suppresses replay before relationship mutation', async () => {
    const { processor, transitionRelationship, commitProcessedActivity } = harness(null, true)
    const result = await processor.process({
      podRoot: 'https://bob.example/',
      recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Follow', { id: followId }),
      now,
    })
    expect(result.status).toBe('duplicate')
    expect(transitionRelationship).not.toHaveBeenCalled()
    expect(commitProcessedActivity).not.toHaveBeenCalled()
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
    const reserveProcessedActivity = jestGlobal.fn()
    const processor = new RelationshipInboxProcessor(
      {
        getRelationship: jestGlobal.fn(),
        transitionRelationship,
      },
      {
        reserveProcessedActivity,
        commitProcessedActivity: jestGlobal.fn(),
        releaseProcessedActivity: jestGlobal.fn(),
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
    expect(reserveProcessedActivity).not.toHaveBeenCalled()
    expect(transitionRelationship).not.toHaveBeenCalled()
  })

  it('quarantines cross-actor replay-key collisions before relationship mutation', async () => {
    const transitionRelationship = jestGlobal.fn()
    const processor = new RelationshipInboxProcessor(
      { getRelationship: jestGlobal.fn(), transitionRelationship },
      {
        reserveProcessedActivity: jestGlobal.fn().mockResolvedValue({ status: 'actor-mismatch' }),
        commitProcessedActivity: jestGlobal.fn(),
        releaseProcessedActivity: jestGlobal.fn(),
      },
      { isBlocked: jestGlobal.fn().mockResolvedValue(false) }
    )

    await expect(processor.process({
      podRoot: 'https://bob.example/',
      recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Follow', { id: followId }),
      now,
    })).rejects.toMatchObject({ code: 'replay_actor_mismatch' })
    expect(transitionRelationship).not.toHaveBeenCalled()
  })

  it('allows only one concurrent processor to mutate the same activity', async () => {
    let reserved = false
    const transitionRelationship = jestGlobal.fn().mockResolvedValue({
      version: 1,
      ownerWebId: bob,
      peerWebId: alice,
      state: 'incoming-pending',
      updatedAt: now.toISOString(),
      activityId: followId,
    })
    const processor = new RelationshipInboxProcessor(
      {
        getRelationship: jestGlobal.fn(),
        transitionRelationship,
      },
      {
        reserveProcessedActivity: jestGlobal.fn().mockImplementation(() => {
          if (reserved) return Promise.resolve({ status: 'in-progress' })
          reserved = true
          return Promise.resolve({
            status: 'acquired',
            lease: { activityId: followId, etag: '"lease-1"' },
          })
        }),
        commitProcessedActivity: jestGlobal.fn().mockImplementation(
          (_podRoot: string, record: ProcessedActivityRecord) => Promise.resolve(record)
        ),
        releaseProcessedActivity: jestGlobal.fn().mockResolvedValue(undefined),
      },
      { isBlocked: jestGlobal.fn().mockResolvedValue(false) }
    )
    const input = {
      podRoot: 'https://bob.example/',
      recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Follow', { id: followId }),
      now,
    }

    const [first, second] = await Promise.all([processor.process(input), processor.process(input)])

    expect([first.status, second.status].sort()).toEqual(['in-progress', 'processed'])
    expect(transitionRelationship).toHaveBeenCalledTimes(1)
  })

  it('releases a reservation only when relationship mutation fails', async () => {
    const releaseProcessedActivity = jestGlobal.fn().mockResolvedValue(undefined)
    const processor = new RelationshipInboxProcessor(
      {
        getRelationship: jestGlobal.fn(),
        transitionRelationship: jestGlobal.fn().mockRejectedValue(new Error('mutation failed')),
      },
      {
        reserveProcessedActivity: jestGlobal.fn().mockResolvedValue({
          status: 'acquired',
          lease: { activityId: followId, etag: '"lease-1"' },
        }),
        commitProcessedActivity: jestGlobal.fn(),
        releaseProcessedActivity,
      },
      { isBlocked: jestGlobal.fn().mockResolvedValue(false) }
    )

    await expect(processor.process({
      podRoot: 'https://bob.example/',
      recipientWebId: bob,
      verifiedActorWebId: alice,
      payload: activity('Follow', { id: followId }),
      now,
    })).rejects.toThrow('mutation failed')
    expect(releaseProcessedActivity).toHaveBeenCalledWith(
      'https://bob.example/',
      { activityId: followId, etag: '"lease-1"' }
    )
  })

  it('exposes typed inbox errors', () => {
    expect(new RelationshipInboxError('test', 'code')).toMatchObject({ code: 'code' })
  })
})
