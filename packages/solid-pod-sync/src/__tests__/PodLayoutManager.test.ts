import {
  ACL_POLICY_RULES,
  assertAclNamespacePolicy,
  PodLayoutManager,
  buildAclDocument,
  buildPodContainerLayout,
  DEFAULT_POLICY_MATRIX,
  deriveOwnerWebId,
  type ContainerVisibility,
} from '../PodLayoutManager.js'

const jestGlobal = import.meta.jest

describe('PodLayoutManager.ensureDefaultLayout', () => {
  it('creates missing containers deterministically', async () => {
    const fetch = jestGlobal.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'HEAD' ? { ok: false, status: 404 } : { ok: true, status: 201 }
    )

    const manager = new PodLayoutManager({
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    const layout = await manager.ensureDefaultLayout('https://alice.example/')

    expect(layout).toEqual(buildPodContainerLayout('https://alice.example/'))
    expect(fetch).toHaveBeenCalledTimes(26)
    for (const containerUrl of Object.values(layout)) {
      expect(fetch).toHaveBeenCalledWith(containerUrl, { method: 'HEAD' })
      expect(fetch).toHaveBeenCalledWith(containerUrl, expect.objectContaining({ method: 'PUT' }))
    }
  })

  it('checks independent containers concurrently after their parents exist', async () => {
    const completed = new Set<string>()
    let activeRequests = 0
    let maximumActiveRequests = 0
    const childDependenciesSatisfied: boolean[] = []
    const fetch = jestGlobal.fn(async (url: string) => {
      if (url.includes('/backpack/notifications/')) {
        childDependenciesSatisfied.push(completed.has('https://alice.example/backpack/'))
      } else if (url.includes('/social/') && url !== 'https://alice.example/social/') {
        childDependenciesSatisfied.push(completed.has('https://alice.example/social/'))
      }
      activeRequests += 1
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
      await Promise.resolve()
      activeRequests -= 1
      completed.add(url)
      return { ok: true, status: 200 }
    })

    const manager = new PodLayoutManager({
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    await manager.ensureDefaultLayout('https://alice.example/')

    expect(maximumActiveRequests).toBeGreaterThan(1)
    expect(childDependenciesSatisfied.every(Boolean)).toBe(true)
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
    const layout = buildPodContainerLayout('https://alice.example/')
    const policies = new Map<string, ContainerVisibility>([
      [layout.docustreamContainer, DEFAULT_POLICY_MATRIX.docustream],
      [layout.socialContainer, DEFAULT_POLICY_MATRIX.social],
      [layout.backpackContainer, DEFAULT_POLICY_MATRIX.backpack],
      [layout.notificationsContainer, DEFAULT_POLICY_MATRIX.notifications],
      [layout.discoveryContainer, DEFAULT_POLICY_MATRIX.discovery],
      [layout.socialInboxContainer, DEFAULT_POLICY_MATRIX.socialInbox],
      [layout.socialOutboxContainer, DEFAULT_POLICY_MATRIX.socialOutbox],
      [layout.socialQuarantineContainer, DEFAULT_POLICY_MATRIX.socialQuarantine],
      [layout.socialConsentContainer, DEFAULT_POLICY_MATRIX.socialConsent],
      [layout.relationshipsContainer, DEFAULT_POLICY_MATRIX.relationships],
      [layout.moderationContainer, DEFAULT_POLICY_MATRIX.moderation],
      [layout.processedActivitiesContainer, DEFAULT_POLICY_MATRIX.processedActivities],
      [layout.deliveryReceiptsContainer, DEFAULT_POLICY_MATRIX.deliveryReceipts],
    ])
    const fetch = jestGlobal.fn(async (url: string, _init?: RequestInit) => {
      const containerUrl = url.replace(/\/\.acl$/, '/')
      return {
        ok: true,
        text: async (): Promise<string> =>
          buildAclDocument(containerUrl, policies.get(containerUrl)!),
      }
    })

    const manager = new PodLayoutManager({
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    await manager.applyPolicyMatrix('https://alice.example/')

    expect(fetch).toHaveBeenCalledTimes(13)
    for (const call of fetch.mock.calls) {
      expect(call[1]).toMatchObject({ method: 'GET' })
    }
  })

  it('writes ACL when policy drift is detected', async () => {
    const fetch = jestGlobal.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'GET'
        ? { ok: true, text: async (): Promise<string> => 'stale-acl' }
        : { ok: true, status: 201 }
    )

    const manager = new PodLayoutManager({
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    await manager.applyPolicyMatrix('https://alice.example/')

    expect(fetch).toHaveBeenCalledTimes(26)
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(13)
  })
})

describe('buildAclDocument consent policies', () => {
  it('grants public append without public read, write, or control for the social inbox', () => {
    const acl = buildAclDocument('https://alice.example/social/inbox/', 'public-append')

    const publicAuthorization = acl.slice(acl.indexOf('<#public>'))
    expect(publicAuthorization).toContain('acl:mode acl:Append')
    expect(publicAuthorization).not.toContain('acl:Read')
    expect(publicAuthorization).not.toContain('acl:Write')
    expect(publicAuthorization).not.toContain('acl:Control')
  })

  it('keeps outbox, quarantine, consent, relationship, and moderation containers owner-only', () => {
    const outboxAcl = buildAclDocument('https://alice.example/social/outbox/', 'private')
    const quarantineAcl = buildAclDocument('https://alice.example/social/quarantine/', 'private')
    const consentAcl = buildAclDocument('https://alice.example/social/consent/', 'private')
    const relationshipsAcl = buildAclDocument(
      'https://alice.example/social/relationships/',
      'private'
    )
    const moderationAcl = buildAclDocument('https://alice.example/social/moderation/', 'private')

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
    expect(() =>
      assertAclNamespacePolicy('not-a-url', 'https://solid.nodezero.social/profile/card#me')
    ).toThrow(ACL_POLICY_RULES.TARGET_MALFORMED)
  })
})
