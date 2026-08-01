import {
  RelationshipOutboxError,
  RelationshipOutboxManager,
} from '../RelationshipOutboxManager.js'
import type { RelationshipActivity } from '../contracts/ConsentfulDiscoveryContract.js'

const jestGlobal = import.meta.jest
const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const activity: RelationshipActivity = {
  version: 1,
  id: 'https://alice.example/social/outbox/follow-bob.jsonld',
  type: 'Follow',
  actor: alice,
  object: bob,
  publishedAt: '2026-08-01T12:00:00.000Z',
}

describe('RelationshipOutboxManager', () => {
  it('writes one owner-bound compact ActivityStreams document', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 201 }))
    const manager = new RelationshipOutboxManager({ fetch })

    await expect(manager.writeActivity('https://alice.example/', activity)).resolves.toEqual(activity)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe(activity.id)
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      type: 'Follow',
      actor: alice,
      object: bob,
    })
  })

  it('reads and validates a persisted activity', async () => {
    const document = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activity.id,
      type: 'Follow',
      actor: alice,
      object: bob,
      published: activity.publishedAt,
    }
    const fetch = jestGlobal.fn().mockResolvedValue(new Response(JSON.stringify(document), {
      status: 200,
      headers: { 'content-type': 'application/ld+json' },
    }))
    await expect(new RelationshipOutboxManager({ fetch }).readActivity(
      'https://alice.example/', activity.id
    )).resolves.toEqual(activity)
  })

  it('rejects foreign actors and activity IDs outside the owner outbox before fetch', async () => {
    const fetch = jestGlobal.fn()
    const manager = new RelationshipOutboxManager({ fetch })

    await expect(manager.writeActivity('https://alice.example/', {
      ...activity,
      actor: 'https://mallory.example/profile/card#me',
    })).rejects.toMatchObject<Partial<RelationshipOutboxError>>({ code: 'actor_owner_mismatch' })
    await expect(manager.writeActivity('https://alice.example/', {
      ...activity,
      id: 'https://mallory.example/social/outbox/follow-bob.jsonld',
    })).rejects.toMatchObject<Partial<RelationshipOutboxError>>({ code: 'activity_outside_outbox' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns null for a missing activity and reports bounded write failures', async () => {
    const missingFetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 404 }))
    await expect(new RelationshipOutboxManager({ fetch: missingFetch }).readActivity(
      'https://alice.example/', activity.id
    )).resolves.toBeNull()

    const failedFetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 503 }))
    await expect(new RelationshipOutboxManager({ fetch: failedFetch }).writeActivity(
      'https://alice.example/', activity
    )).rejects.toMatchObject<Partial<RelationshipOutboxError>>({ code: 'outbox_write_failed' })
  })
})
