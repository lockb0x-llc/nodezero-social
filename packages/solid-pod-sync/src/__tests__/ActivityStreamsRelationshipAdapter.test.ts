import {
  ACTIVITYSTREAMS_CONTEXT,
  ActivityStreamsRelationshipError,
  parseRelationshipActivity,
  serializeRelationshipActivity,
} from '../adapters/ActivityStreamsRelationshipAdapter.js'

const follow = {
  version: 1 as const,
  id: 'https://alice.example/social/outbox/follow-bob',
  type: 'Follow' as const,
  actor: 'https://alice.example/profile/card#me',
  object: 'https://bob.example/profile/card#me',
  publishedAt: '2026-08-01T12:00:00.000Z',
}

describe('ActivityStreamsRelationshipAdapter', () => {
  it('round-trips a compact Follow activity', () => {
    const serialized = serializeRelationshipActivity(follow)
    expect(serialized).toEqual({
      '@context': ACTIVITYSTREAMS_CONTEXT,
      id: follow.id,
      type: 'Follow',
      actor: follow.actor,
      object: follow.object,
      published: follow.publishedAt,
    })
    expect(parseRelationshipActivity(serialized)).toEqual(follow)
  })

  it('parses nested actor/object identifiers and a context array', () => {
    expect(parseRelationshipActivity({
      '@context': [ACTIVITYSTREAMS_CONTEXT, { nz: 'https://nodezero.social/ns#' }],
      id: 'https://bob.example/social/outbox/accept-alice',
      type: 'Accept',
      actor: { id: follow.object, type: 'Person' },
      object: { id: follow.id, type: 'Follow' },
      inReplyTo: follow.id,
      published: '2026-08-01T12:05:00.000Z',
    })).toEqual({
      version: 1,
      id: 'https://bob.example/social/outbox/accept-alice',
      type: 'Accept',
      actor: follow.object,
      object: follow.id,
      inReplyTo: follow.id,
      publishedAt: '2026-08-01T12:05:00.000Z',
    })
  })

  it('rejects missing context and unsupported activity types', () => {
    expect(() => parseRelationshipActivity({ ...serializeRelationshipActivity(follow), '@context': undefined }))
      .toThrow(ActivityStreamsRelationshipError)
    expect(() => parseRelationshipActivity({ ...serializeRelationshipActivity(follow), type: 'Like' }))
      .toThrow('Relationship activity contract validation failed')
  })

  it('rejects Accept, Reject, and Undo without an original activity reference', () => {
    for (const type of ['Accept', 'Reject', 'Undo'] as const) {
      expect(() => parseRelationshipActivity({
        ...serializeRelationshipActivity(follow),
        id: `https://bob.example/social/outbox/${type.toLowerCase()}-alice`,
        type,
        actor: follow.object,
        object: follow.id,
      })).toThrow(`${type} must reference the activity it answers or undoes`)
    }
  })

  it('does not interpret syntactic validity as sender authentication', () => {
    const parsed = parseRelationshipActivity(serializeRelationshipActivity(follow))
    expect(parsed).not.toHaveProperty('verified')
    expect(parsed).not.toHaveProperty('authenticated')
  })
})
