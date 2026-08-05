import {
  validateDataBackpackProfile,
  validatePublicProfileDocument,
  validatePrivateProfilePreferencesDocument,
  validateConnectionRecord,
  validateStreamItem,
  assertValidDataBackpackProfile,
  assertValidPublicProfileDocument,
  assertValidPrivateProfilePreferencesDocument,
  assertValidConnectionRecord,
  assertValidStreamItem,
  createDefaultDiscoveryConsent,
  validateDiscoveryConsent,
  validateDiscoveryManifest,
  validateRelationshipActivity,
  validateRelationshipRecord,
  validateModerationRecord,
  validateDeliveryReceipt,
  validateProcessedActivityRecord,
  canTransitionRelationship,
} from '../index.js'
import {
  validDataBackpackFixtures,
  invalidDataBackpackFixtures,
} from '../contracts/fixtures/dataBackpackFixtures.js'
import {
  validSocialGraphFixtures,
  invalidSocialGraphFixtures,
} from '../contracts/fixtures/socialGraphFixtures.js'
import {
  validDocustreamFixtures,
  invalidDocustreamFixtures,
} from '../contracts/fixtures/docustreamFixtures.js'

describe('Data Backpack contract conformance', () => {
  it('accepts valid fixtures', () => {
    for (const fixture of validDataBackpackFixtures) {
      expect(
        validatePublicProfileDocument({
          displayName: fixture.displayName,
          bio: fixture.bio,
          ...(fixture.avatarUrl ? { avatarUrl: fixture.avatarUrl } : {}),
          ...(fixture.externalUrl ? { externalUrl: fixture.externalUrl } : {}),
        })
      ).toEqual([])
      expect(
        validatePrivateProfilePreferencesDocument({
          interests: fixture.interests,
          isNsfw: fixture.isNsfw,
        })
      ).toEqual([])
      expect(validateDataBackpackProfile(fixture)).toEqual([])
      expect(() =>
        assertValidPublicProfileDocument({
          displayName: fixture.displayName,
          bio: fixture.bio,
          ...(fixture.avatarUrl ? { avatarUrl: fixture.avatarUrl } : {}),
          ...(fixture.externalUrl ? { externalUrl: fixture.externalUrl } : {}),
        })
      ).not.toThrow()
      expect(() =>
        assertValidPrivateProfilePreferencesDocument({
          interests: fixture.interests,
          isNsfw: fixture.isNsfw,
        })
      ).not.toThrow()
      expect(() => assertValidDataBackpackProfile(fixture)).not.toThrow()
    }
  })

  it('rejects invalid fixtures', () => {
    for (const fixture of invalidDataBackpackFixtures) {
      const issues = validateDataBackpackProfile(fixture as never)
      expect(issues.length).toBeGreaterThan(0)
      expect(() => assertValidDataBackpackProfile(fixture as never)).toThrow(
        'Data Backpack contract validation failed'
      )
    }
  })
})

describe('Social Graph contract conformance', () => {
  it('accepts valid fixtures', () => {
    for (const fixture of validSocialGraphFixtures) {
      expect(validateConnectionRecord(fixture)).toEqual([])
      expect(() => assertValidConnectionRecord(fixture)).not.toThrow()
    }
  })

  it('rejects invalid fixtures', () => {
    for (const fixture of invalidSocialGraphFixtures) {
      const issues = validateConnectionRecord(fixture as never)
      expect(issues.length).toBeGreaterThan(0)
      expect(() => assertValidConnectionRecord(fixture as never)).toThrow(
        'Social Graph contract validation failed'
      )
    }
  })
})

describe('DocuStream contract conformance', () => {
  it('accepts valid fixtures', () => {
    for (const fixture of validDocustreamFixtures) {
      expect(validateStreamItem(fixture)).toEqual([])
      expect(() => assertValidStreamItem(fixture)).not.toThrow()
    }
  })

  it('rejects invalid fixtures', () => {
    for (const fixture of invalidDocustreamFixtures) {
      const issues = validateStreamItem(fixture as never)
      expect(issues.length).toBeGreaterThan(0)
      expect(() => assertValidStreamItem(fixture as never)).toThrow(
        'DocuStream contract validation failed'
      )
    }
  })

  it('keeps valid fixture set stable', () => {
    expect(validDocustreamFixtures).toMatchSnapshot()
  })
})

describe('Consentful discovery contract conformance', () => {
  const alice = 'https://solid.example/alice/profile/card#me'
  const bob = 'https://solid.example/bob/profile/card#me'
  const publishedAt = '2026-07-31T12:00:00.000Z'
  const expiresAt = '2026-08-07T12:00:00.000Z'
  const activityId = 'https://solid.example/alice/social/outbox/follow-bob'

  it('defaults every discovery consent scope off', () => {
    const consent = createDefaultDiscoveryConsent(alice, publishedAt)
    expect(validateDiscoveryConsent(consent)).toEqual([])
    expect(consent).toMatchObject({
      publicListing: false,
      publicIndexing: false,
      nearbyPresence: false,
      inboundContactRequests: false,
      localBroadcasts: false,
    })
  })

  it('accepts a minimal public discovery manifest and rejects private-looking duplicates', () => {
    expect(
      validateDiscoveryManifest({
        version: 1,
        webId: alice,
        publishedAt,
        expiresAt,
        displayName: 'Alice',
        publicInterests: ['solid', 'privacy'],
        capabilities: ['relationship-requests'],
        inboxUrl: 'https://solid.example/alice/social/inbox/',
      })
    ).toEqual([])

    expect(
      validateDiscoveryManifest({
        version: 1,
        webId: alice,
        publishedAt,
        expiresAt: publishedAt,
        publicInterests: ['solid', 'solid'],
      }).map((issue) => issue.field)
    ).toEqual(expect.arrayContaining(['expiresAt', 'publicInterests']))

    expect(
      validateDiscoveryManifest({
        version: 1,
        webId: alice,
        publishedAt,
        expiresAt: new Date(Date.parse(publishedAt) + 8 * 24 * 60 * 60_000).toISOString(),
      }).map((issue) => issue.field)
    ).toContain('expiresAt')

    expect(
      validateDiscoveryManifest({
        version: 1,
        webId: alice,
        publishedAt,
        expiresAt,
        privateInterests: ['medical'],
        trustCircleMembers: [bob],
        blockedWebIds: [bob],
        locationHistory: ['8928308280fffff'],
      } as unknown as Parameters<typeof validateDiscoveryManifest>[0]).map((issue) => issue.field)
    ).toEqual(
      expect.arrayContaining([
        'privateInterests',
        'trustCircleMembers',
        'blockedWebIds',
        'locationHistory',
      ])
    )
  })

  it('requires answer activities to reference the original activity', () => {
    expect(
      validateRelationshipActivity({
        version: 1,
        id: activityId,
        type: 'Follow',
        actor: alice,
        object: bob,
        publishedAt,
      })
    ).toEqual([])

    expect(
      validateRelationshipActivity({
        version: 1,
        id: 'https://solid.example/bob/social/outbox/accept-alice',
        type: 'Accept',
        actor: bob,
        object: activityId,
        publishedAt,
      }).map((issue) => issue.field)
    ).toContain('inReplyTo')
  })

  it('defines conservative relationship transitions', () => {
    expect(canTransitionRelationship('none', 'outgoing-pending')).toBe(true)
    expect(canTransitionRelationship('outgoing-pending', 'accepted')).toBe(true)
    expect(canTransitionRelationship('legacy-connected', 'accepted')).toBe(true)
    expect(canTransitionRelationship('accepted', 'outgoing-pending')).toBe(false)
    expect(canTransitionRelationship('rejected', 'accepted')).toBe(false)
  })

  it('validates private relationship, moderation, delivery, and replay records', () => {
    expect(
      validateRelationshipRecord({
        version: 1,
        ownerWebId: alice,
        peerWebId: bob,
        state: 'outgoing-pending',
        updatedAt: publishedAt,
        activityId,
      })
    ).toEqual([])
    expect(
      validateModerationRecord({
        version: 1,
        ownerWebId: alice,
        subjectWebId: bob,
        action: 'block',
        createdAt: publishedAt,
      })
    ).toEqual([])
    expect(
      validateDeliveryReceipt({
        version: 1,
        activityId,
        senderWebId: alice,
        recipientWebId: bob,
        status: 'delivered',
        updatedAt: publishedAt,
      })
    ).toEqual([])
    expect(
      validateProcessedActivityRecord({
        version: 1,
        activityId,
        actorWebId: alice,
        processedAt: publishedAt,
        expiresAt,
      })
    ).toEqual([])
  })

  it('rejects self-relationships and invalid replay expiry', () => {
    expect(
      validateRelationshipRecord({
        version: 1,
        ownerWebId: alice,
        peerWebId: alice,
        state: 'accepted',
        updatedAt: publishedAt,
      }).map((issue) => issue.field)
    ).toContain('peerWebId')
    expect(
      validateProcessedActivityRecord({
        version: 1,
        activityId,
        actorWebId: alice,
        processedAt: publishedAt,
        expiresAt: publishedAt,
      }).map((issue) => issue.field)
    ).toContain('expiresAt')
  })
})
