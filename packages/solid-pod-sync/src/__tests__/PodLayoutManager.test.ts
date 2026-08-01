import {
  ACL_POLICY_RULES,
  assertAclNamespacePolicy,
  PodLayoutManager,
  buildAclDocument,
  buildPodContainerLayout,
  DEFAULT_POLICY_MATRIX,
  deriveOwnerWebId,
} from '../PodLayoutManager.js'

const jestGlobal = import.meta.jest

describe('PodLayoutManager.ensureDefaultLayout', () => {
  it('creates missing containers deterministically', async () => {
    const fetch = jestGlobal.fn()
    for (let index = 0; index < 13; index += 1) {
      fetch
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: true, status: 201 })
    }

    const manager = new PodLayoutManager({ fetch })
    const layout = await manager.ensureDefaultLayout('https://alice.example/')

    expect(layout).toEqual(buildPodContainerLayout('https://alice.example/'))
    expect(fetch).toHaveBeenCalledTimes(26)
    expect(fetch.mock.calls[0][0]).toBe('https://alice.example/public/docustream/')
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'HEAD' })
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT' })
    expect(fetch.mock.calls[9][0]).toBe('https://alice.example/public/discovery/')
    expect(fetch.mock.calls[11][0]).toBe('https://alice.example/social/inbox/')
    expect(fetch.mock.calls[13][0]).toBe('https://alice.example/social/outbox/')
    expect(fetch.mock.calls[15][0]).toBe('https://alice.example/social/quarantine/')
    expect(fetch.mock.calls[17][0]).toBe('https://alice.example/social/consent/')
    expect(fetch.mock.calls[25][0]).toBe('https://alice.example/social/delivery-receipts/')
  })

  it('does not recreate containers that already exist', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue({ ok: true, status: 200 })

    const manager = new PodLayoutManager({ fetch })
    await manager.ensureDefaultLayout('https://alice.example/')

    expect(fetch).toHaveBeenCalledTimes(13)
    for (const call of fetch.mock.calls) {
      expect(call[1]).toMatchObject({ method: 'HEAD' })
    }
  })
})

describe('PodLayoutManager.applyPolicyMatrix', () => {
  it('skips ACL write when current ACL already matches desired policy', async () => {
    const docustreamAcl = buildAclDocument(
      'https://alice.example/public/docustream/',
      DEFAULT_POLICY_MATRIX.docustream
    )
    const socialAcl = buildAclDocument('https://alice.example/social/', DEFAULT_POLICY_MATRIX.social)
    const backpackAcl = buildAclDocument('https://alice.example/backpack/', DEFAULT_POLICY_MATRIX.backpack)
    const notificationsAcl = buildAclDocument(
      'https://alice.example/backpack/notifications/',
      DEFAULT_POLICY_MATRIX.notifications
    )
    const discoveryAcl = buildAclDocument(
      'https://alice.example/public/discovery/',
      DEFAULT_POLICY_MATRIX.discovery
    )
    const socialInboxAcl = buildAclDocument(
      'https://alice.example/social/inbox/',
      DEFAULT_POLICY_MATRIX.socialInbox
    )
    const socialOutboxAcl = buildAclDocument(
      'https://alice.example/social/outbox/',
      DEFAULT_POLICY_MATRIX.socialOutbox
    )
    const socialQuarantineAcl = buildAclDocument(
      'https://alice.example/social/quarantine/',
      DEFAULT_POLICY_MATRIX.socialQuarantine
    )
    const socialConsentAcl = buildAclDocument(
      'https://alice.example/social/consent/',
      DEFAULT_POLICY_MATRIX.socialConsent
    )
    const relationshipsAcl = buildAclDocument(
      'https://alice.example/social/relationships/',
      DEFAULT_POLICY_MATRIX.relationships
    )
    const moderationAcl = buildAclDocument(
      'https://alice.example/social/moderation/',
      DEFAULT_POLICY_MATRIX.moderation
    )
    const processedActivitiesAcl = buildAclDocument(
      'https://alice.example/social/processed-activities/',
      DEFAULT_POLICY_MATRIX.processedActivities
    )
    const deliveryReceiptsAcl = buildAclDocument(
      'https://alice.example/social/delivery-receipts/',
      DEFAULT_POLICY_MATRIX.deliveryReceipts
    )

    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => docustreamAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => socialAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => backpackAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => notificationsAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => discoveryAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => socialInboxAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => socialOutboxAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => socialQuarantineAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => socialConsentAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => relationshipsAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => moderationAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => processedActivitiesAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => deliveryReceiptsAcl })

    const manager = new PodLayoutManager({ fetch })
    await manager.applyPolicyMatrix('https://alice.example/')

    expect(fetch).toHaveBeenCalledTimes(13)
    for (const call of fetch.mock.calls) {
      expect(call[1]).toMatchObject({ method: 'GET' })
    }
  })

  it('writes ACL when policy drift is detected', async () => {
    const fetch = jestGlobal.fn()
    for (let index = 0; index < 13; index += 1) {
      fetch
        .mockResolvedValueOnce({ ok: true, text: async () => 'stale-acl' })
        .mockResolvedValueOnce({ ok: true, status: 201 })
    }

    const manager = new PodLayoutManager({ fetch })
    await manager.applyPolicyMatrix('https://alice.example/')

    expect(fetch).toHaveBeenCalledTimes(26)
    for (let index = 1; index < 26; index += 2) {
      expect(fetch.mock.calls[index][1]).toMatchObject({ method: 'PUT' })
    }
  })
})

describe('buildAclDocument consent policies', () => {
  it('grants public append without public read, write, or control for the social inbox', () => {
    const acl = buildAclDocument(
      'https://alice.example/social/inbox/',
      'public-append'
    )

    const publicAuthorization = acl.slice(acl.indexOf('<#public>'))
    expect(publicAuthorization).toContain('acl:mode acl:Append')
    expect(publicAuthorization).not.toContain('acl:Read')
    expect(publicAuthorization).not.toContain('acl:Write')
    expect(publicAuthorization).not.toContain('acl:Control')
  })

  it('keeps outbox, quarantine, consent, relationship, and moderation containers owner-only', () => {
    const outboxAcl = buildAclDocument(
      'https://alice.example/social/outbox/',
      'private'
    )
    const quarantineAcl = buildAclDocument(
      'https://alice.example/social/quarantine/',
      'private'
    )
    const consentAcl = buildAclDocument(
      'https://alice.example/social/consent/',
      'private'
    )
    const relationshipsAcl = buildAclDocument(
      'https://alice.example/social/relationships/',
      'private'
    )
    const moderationAcl = buildAclDocument(
      'https://alice.example/social/moderation/',
      'private'
    )

    expect(outboxAcl).not.toContain('<#public>')
    expect(quarantineAcl).not.toContain('<#public>')
    expect(consentAcl).not.toContain('<#public>')
    expect(relationshipsAcl).not.toContain('<#public>')
    expect(moderationAcl).not.toContain('<#public>')
  })
})

describe('deriveOwnerWebId', () => {
  it('uses account-segment WebID for path-based pods', () => {
    expect(deriveOwnerWebId('https://solid.nodezero.social/alice/public/docustream/')).toBe(
      'https://solid.nodezero.social/alice/profile/card#me'
    )
  })

  it('falls back to host root WebID for host-root pods', () => {
    expect(deriveOwnerWebId('https://alice.example/public/docustream/')).toBe(
      'https://alice.example/profile/card#me'
    )
  })

  it('keeps root WebID for reserved top-level segments', () => {
    expect(deriveOwnerWebId('https://solid.nodezero.social/public/docustream/')).toBe(
      'https://solid.nodezero.social/profile/card#me'
    )
  })

  it('throws owner mismatch rule when overridden owner leaves account namespace', () => {
    expect(() =>
      buildAclDocument(
        'https://solid.nodezero.social/alice/public/docustream/',
        'public-read',
        'https://solid.nodezero.social/profile/card#me'
      )
    ).toThrow(ACL_POLICY_RULES.OWNER_MISMATCH)
  })

  it('throws malformed rule for invalid container URL', () => {
    expect(() => assertAclNamespacePolicy('not-a-url', 'https://solid.nodezero.social/profile/card#me'))
      .toThrow(ACL_POLICY_RULES.TARGET_MALFORMED)
  })
})
