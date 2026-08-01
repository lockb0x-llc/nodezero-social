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

  it('returns a bounded drainable batch when the inbox exceeds the processing limit', async () => {
    const turtle = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <${inboxUrl}> a ldp:BasicContainer ;
        ldp:contains <${inboxUrl}a>, <${inboxUrl}b>, <${inboxUrl}c> .
    `
    const fetch = jestGlobal.fn().mockResolvedValue(responseWithUrl(turtle, inboxUrl, 'text/turtle'))
    await expect(new RelationshipInboxReader(
      { fetch },
      { maxResources: 2 }
    ).listResourceUrls('https://bob.example/'))
      .resolves.toEqual([`${inboxUrl}a`, `${inboxUrl}b`])
  })

  it('rejects a large container that yields no drainable resources', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue(responseWithUrl(
      'x'.repeat(128), inboxUrl, 'text/turtle'
    ))
    await expect(new RelationshipInboxReader(
      { fetch },
      { maxContainerBytes: 32 }
    ).listResourceUrls('https://bob.example/'))
      .rejects.toMatchObject({ code: 'inbox_container_too_large' })
  })

  it('cancels an adversarially chunked oversized container after a drainable batch', async () => {
    const encoder = new TextEncoder()
    const chunks = [
      '@prefix ldp: <http://www.w3.',
      'org/ns/ldp#> .\n',
      `<${inboxUrl}> <https://example.test/note> "dot . in a string" . # dot.in.comment\n`,
      `<${inboxUrl}> ldp:contains <${inboxUrl}a>, <https://bob.exa`,
      'mple/social/inbox/b> .\n',
      ' '.repeat(2048),
    ].map((chunk) => encoder.encode(chunk))
    let chunkIndex = 0
    let cancelled = false
    let deliveredBytes = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller): void {
        const chunk = chunks[chunkIndex]
        chunkIndex += 1
        if (chunk) {
          deliveredBytes += chunk.byteLength
          controller.enqueue(chunk)
        }
        else controller.close()
      },
      cancel(): void {
        cancelled = true
      },
    }, { highWaterMark: 0 })
    const response = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/turtle' },
    })
    Object.defineProperty(response, 'url', { value: inboxUrl })
    const fetch = jestGlobal.fn().mockResolvedValue(response)
    await expect(new RelationshipInboxReader(
      { fetch },
      { maxResources: 2, maxContainerBytes: 512 }
    ).listResourceUrls('https://bob.example/'))
      .resolves.toEqual([`${inboxUrl}a`, `${inboxUrl}b`])
    expect(cancelled).toBe(true)
    expect(deliveredBytes).toBeLessThan(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
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
