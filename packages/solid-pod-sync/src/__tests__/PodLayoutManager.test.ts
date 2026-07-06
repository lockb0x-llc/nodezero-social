import {
  PodLayoutManager,
  buildAclDocument,
  buildPodContainerLayout,
  DEFAULT_POLICY_MATRIX,
  deriveOwnerWebId,
} from '../PodLayoutManager.js'

const jestGlobal = import.meta.jest

describe('PodLayoutManager.ensureDefaultLayout', () => {
  it('creates missing containers deterministically', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 201 })
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 201 })
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 201 })

    const manager = new PodLayoutManager({ fetch })
    const layout = await manager.ensureDefaultLayout('https://alice.example/')

    expect(layout).toEqual(buildPodContainerLayout('https://alice.example/'))
    expect(fetch).toHaveBeenCalledTimes(6)
    expect(fetch.mock.calls[0][0]).toBe('https://alice.example/public/docustream/')
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'HEAD' })
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT' })
  })

  it('does not recreate containers that already exist', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const manager = new PodLayoutManager({ fetch })
    await manager.ensureDefaultLayout('https://alice.example/')

    expect(fetch).toHaveBeenCalledTimes(3)
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

    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => docustreamAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => socialAcl })
      .mockResolvedValueOnce({ ok: true, text: async () => backpackAcl })

    const manager = new PodLayoutManager({ fetch })
    await manager.applyPolicyMatrix('https://alice.example/')

    expect(fetch).toHaveBeenCalledTimes(3)
    for (const call of fetch.mock.calls) {
      expect(call[1]).toMatchObject({ method: 'GET' })
    }
  })

  it('writes ACL when policy drift is detected', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => 'stale-acl' })
      .mockResolvedValueOnce({ ok: true, status: 201 })
      .mockResolvedValueOnce({ ok: true, text: async () => 'stale-acl' })
      .mockResolvedValueOnce({ ok: true, status: 201 })
      .mockResolvedValueOnce({ ok: true, text: async () => 'stale-acl' })
      .mockResolvedValueOnce({ ok: true, status: 201 })

    const manager = new PodLayoutManager({ fetch })
    await manager.applyPolicyMatrix('https://alice.example/')

    expect(fetch).toHaveBeenCalledTimes(6)
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT' })
    expect(fetch.mock.calls[3][1]).toMatchObject({ method: 'PUT' })
    expect(fetch.mock.calls[5][1]).toMatchObject({ method: 'PUT' })
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
})
