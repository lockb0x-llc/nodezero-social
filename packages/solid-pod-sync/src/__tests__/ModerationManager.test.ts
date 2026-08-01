import { ModerationManager } from '../ModerationManager.js'

const jestGlobal = import.meta.jest
const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const timestamp = '2026-08-01T12:00:00.000Z'

function responseWithUrl(body: string): Response {
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle' },
  })
  Object.defineProperty(response, 'url', {
    value: 'https://alice.example/social/moderation/index',
  })
  return response
}

describe('ModerationManager', () => {
  it('stores private block state under the owner WebID', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const manager = new ModerationManager({ fetch })

    await expect(manager.setModeration('https://alice.example/', {
      subjectWebId: bob,
      action: 'block',
      createdAt: timestamp,
      reasonCode: 'user-requested',
    })).resolves.toEqual({
      version: 1,
      ownerWebId: alice,
      subjectWebId: bob,
      action: 'block',
      createdAt: timestamp,
      reasonCode: 'user-requested',
    })

    const body = String(fetch.mock.calls[1]?.[1]?.body ?? '')
    expect(body).toContain('ModerationRecord')
    expect(body).toContain('user-requested')
  })

  it('reports block state and lists stable moderation records', async () => {
    const carol = 'https://carol.example/profile/card#me'
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://alice.example/social/moderation/index#mute-${encodeURIComponent(carol)}>
        a nz:ModerationRecord ; nz:version 1 ; nz:ownerWebId <${alice}> ;
        nz:subjectWebId <${carol}> ; nz:moderationAction "mute" ; nz:createdAt "${timestamp}" .
      <https://alice.example/social/moderation/index#block-${encodeURIComponent(bob)}>
        a nz:ModerationRecord ; nz:version 1 ; nz:ownerWebId <${alice}> ;
        nz:subjectWebId <${bob}> ; nz:moderationAction "block" ; nz:createdAt "${timestamp}" .
    `
    const fetch = jestGlobal.fn().mockImplementation(() => Promise.resolve(responseWithUrl(body)))
    const manager = new ModerationManager({ fetch })

    await expect(manager.isBlocked('https://alice.example/', bob)).resolves.toBe(true)
    await expect(manager.isBlocked('https://alice.example/', carol)).resolves.toBe(false)
    const records = await manager.listModeration('https://alice.example/')
    expect(records.map((record) => `${record.subjectWebId}:${record.action}`)).toEqual([
      `${bob}:block`,
      `${carol}:mute`,
    ])
  })

  it('removes moderation state idempotently', async () => {
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://alice.example/social/moderation/index#block-${encodeURIComponent(bob)}>
        a nz:ModerationRecord ; nz:version 1 ; nz:ownerWebId <${alice}> ;
        nz:subjectWebId <${bob}> ; nz:moderationAction "block" ; nz:createdAt "${timestamp}" .
    `
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(responseWithUrl(body))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new ModerationManager({ fetch })

    await manager.removeModeration('https://alice.example/', bob, 'block')
    expect(String(fetch.mock.calls[1]?.[1]?.body ?? '')).toContain('DELETE DATA')

    const missingFetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 404 }))
    await expect(
      new ModerationManager({ fetch: missingFetch }).removeModeration(
        'https://alice.example/', bob, 'block'
      )
    ).resolves.toBeUndefined()
  })

  it('rejects attempts to moderate the owner identity', async () => {
    const fetch = jestGlobal.fn()
    await expect(new ModerationManager({ fetch }).setModeration('https://alice.example/', {
      subjectWebId: alice,
      action: 'block',
      createdAt: timestamp,
    })).rejects.toThrow('Moderation record contract validation failed')
    expect(fetch).not.toHaveBeenCalled()
  })
})
