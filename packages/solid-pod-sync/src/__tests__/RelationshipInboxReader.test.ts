import { RelationshipInboxReader } from '../RelationshipInboxReader.js'

const jestGlobal = import.meta.jest
const inboxUrl = 'https://bob.example/social/inbox/'
const resourceUrl = `${inboxUrl}activity-1`

function responseWithUrl(body: string, url: string, contentType: string): Response {
  const response = new Response(body, { status: 200, headers: { 'content-type': contentType } })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

describe('RelationshipInboxReader', () => {
  it('lists only sorted direct child resources from structured LDP metadata', async () => {
    const turtle = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <${inboxUrl}> a ldp:BasicContainer ;
        ldp:contains <${inboxUrl}b>, <${inboxUrl}nested/a>, <${inboxUrl}a> .
    `
    const fetch = jestGlobal.fn().mockResolvedValue(responseWithUrl(turtle, inboxUrl, 'text/turtle'))
    await expect(new RelationshipInboxReader({ fetch }).listResourceUrls('https://bob.example/'))
      .resolves.toEqual([`${inboxUrl}a`, `${inboxUrl}b`])
  })

  it('reads bounded JSON-LD from a direct child', async () => {
    const payload = { '@context': 'https://www.w3.org/ns/activitystreams', type: 'Follow' }
    const fetch = jestGlobal.fn().mockResolvedValue(responseWithUrl(
      JSON.stringify(payload), resourceUrl, 'application/ld+json'
    ))
    await expect(new RelationshipInboxReader({ fetch }).readResource(
      'https://bob.example/', resourceUrl
    )).resolves.toEqual({ sourceUrl: resourceUrl, payload })
  })

  it('rejects out-of-scope, oversized, and unsupported resources', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue(responseWithUrl('{}', resourceUrl, 'text/plain'))
    const reader = new RelationshipInboxReader({ fetch }, { maxResourceBytes: 4 })
    await expect(reader.readResource(
      'https://bob.example/', 'https://mallory.example/social/inbox/activity-1'
    )).rejects.toMatchObject({ code: 'inbox_resource_scope' })
    await expect(reader.readResource('https://bob.example/', resourceUrl))
      .rejects.toMatchObject({ code: 'inbox_resource_media_type' })

    const largeFetch = jestGlobal.fn().mockResolvedValue(responseWithUrl(
      JSON.stringify({ value: 'large' }), resourceUrl, 'application/json'
    ))
    await expect(new RelationshipInboxReader(
      { fetch: largeFetch }, { maxResourceBytes: 4 }
    ).readResource('https://bob.example/', resourceUrl))
      .rejects.toMatchObject({ code: 'inbox_resource_too_large' })
  })

  it('removes handled direct-child resources idempotently', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await new RelationshipInboxReader({ fetch }).removeResource(
      'https://bob.example/', resourceUrl
    )
    expect(fetch).toHaveBeenCalledWith(resourceUrl, { method: 'DELETE' })

    const missingFetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 404 }))
    await expect(new RelationshipInboxReader({ fetch: missingFetch }).removeResource(
      'https://bob.example/', resourceUrl
    )).resolves.toBeUndefined()
  })
})
