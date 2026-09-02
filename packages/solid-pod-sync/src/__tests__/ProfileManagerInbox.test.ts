import { ProfileManager } from '../ProfileManager.js'

const jestGlobal = import.meta.jest
const podRoot = 'https://alice.example/'
const profileUrl = 'https://alice.example/profile/card'
const inboxUrl = 'https://alice.example/social/inbox/'

function existingProfile(extraTriples = ''): string {
  return `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    @prefix ldp: <http://www.w3.org/ns/ldp#> .
    <${profileUrl}#me> a foaf:Person ;
      foaf:name "Alice" .
    ${extraTriples}
  `
}

function turtleResponse(body: string): Response {
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle', etag: '"v1"' },
  })
  Object.defineProperty(response, 'url', { value: profileUrl })
  return response
}

describe('ProfileManager.setInboxAdvertisement', () => {
  it('advertises ldp:inbox on the WebID profile card when enabled', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(turtleResponse(existingProfile()))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new ProfileManager({ fetch })

    const url = await manager.setInboxAdvertisement(podRoot, true)

    expect(url).toBe(profileUrl)
    const body = String(fetch.mock.calls[1]?.[1]?.body ?? '')
    expect(body).toContain('http://www.w3.org/ns/ldp#inbox')
    expect(body).toContain(inboxUrl)
  })

  it('withdraws the advertisement when consent is revoked', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(
        turtleResponse(existingProfile(`<${profileUrl}#me> ldp:inbox <${inboxUrl}> .`))
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new ProfileManager({ fetch })

    await manager.setInboxAdvertisement(podRoot, false)

    const body = String(fetch.mock.calls[1]?.[1]?.body ?? '')
    // A DELETE-then-INSERT patch may name the predicate; the inbox must not be re-inserted.
    expect(body).not.toMatch(/INSERT[\s\S]*ldp#inbox/i)
  })

  it('preserves unrelated profile data', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(turtleResponse(existingProfile()))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new ProfileManager({ fetch })

    await manager.setInboxAdvertisement(podRoot, true)

    const body = String(fetch.mock.calls[1]?.[1]?.body ?? '')
    expect(body).not.toContain('foaf:name "Alice"')
    expect(body).not.toMatch(/DELETE[\s\S]*foaf\/0\.1\/name/i)
  })

  it('does not create a profile document just to withdraw an advertisement', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 404 }))
    const manager = new ProfileManager({ fetch })

    await manager.setInboxAdvertisement(podRoot, false)

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
