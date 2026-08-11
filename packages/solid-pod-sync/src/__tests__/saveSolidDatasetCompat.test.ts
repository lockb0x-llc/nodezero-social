import { buildThing, createThing, setThing } from '@inrupt/solid-client'
import {
  getSolidDatasetSnapshot,
  saveSolidDatasetWithPatchFallback,
} from '../saveSolidDatasetCompat.js'

const jestGlobal = import.meta.jest
const datasetUrl = 'https://alice.example/settings/publicTypeIndex.ttl'

function datasetResponse(etag = '"index-1"'): Response {
  const response = new Response(`<${datasetUrl}#entry> <https://example.test/name> "Existing" .`, {
    status: 200,
    headers: { 'content-type': 'text/turtle', etag },
  })
  Object.defineProperty(response, 'url', { value: datasetUrl })
  return response
}

describe('saveSolidDatasetWithPatchFallback', () => {
  it('replaces an existing dataset with its ETag when PATCH is unsupported', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(datasetResponse())
      .mockResolvedValueOnce(new Response('', { status: 501 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const snapshot = await getSolidDatasetSnapshot(datasetUrl, fetch)
    const updated = setThing(
      snapshot.dataset,
      buildThing(createThing({ url: `${datasetUrl}#new` }))
        .setStringNoLocale('https://example.test/name', 'New')
        .build()
    )

    await saveSolidDatasetWithPatchFallback(datasetUrl, updated, fetch, snapshot.etag)

    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH' })
    const patchInit = fetch.mock.calls[1]?.[1] as unknown as RequestInit
    expect(new Headers(patchInit.headers).get('if-match')).toBe('"index-1"')
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'text/turtle', 'if-match': '"index-1"' },
    })
    const replacement = String(fetch.mock.calls[2]?.[1]?.body ?? '')
    expect(replacement).toContain('Existing')
    expect(replacement).toContain('New')
  })

  it('propagates a stale ETag response from the guarded replacement', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(datasetResponse())
      .mockResolvedValueOnce(new Response('', { status: 415 }))
      .mockResolvedValueOnce(new Response('', { status: 412 }))
    const snapshot = await getSolidDatasetSnapshot(datasetUrl, fetch)
    const updated = setThing(
      snapshot.dataset,
      buildThing(createThing({ url: `${datasetUrl}#new` })).build()
    )

    await expect(
      saveSolidDatasetWithPatchFallback(datasetUrl, updated, fetch, snapshot.etag)
    ).rejects.toMatchObject({ statusCode: 412 })
  })

  it('does not replace datasets for unrelated PATCH failures', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(datasetResponse())
      .mockResolvedValueOnce(new Response('', { status: 500 }))
    const snapshot = await getSolidDatasetSnapshot(datasetUrl, fetch)
    const updated = setThing(
      snapshot.dataset,
      buildThing(createThing({ url: `${datasetUrl}#new` })).build()
    )

    await expect(
      saveSolidDatasetWithPatchFallback(datasetUrl, updated, fetch, snapshot.etag)
    ).rejects.toMatchObject({ statusCode: 500 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('refuses to mutate an existing dataset without an ETag', async () => {
    const fetch = jestGlobal.fn().mockResolvedValueOnce(datasetResponse(''))
    const snapshot = await getSolidDatasetSnapshot(datasetUrl, fetch)
    const updated = setThing(
      snapshot.dataset,
      buildThing(createThing({ url: `${datasetUrl}#new` })).build()
    )

    await expect(
      saveSolidDatasetWithPatchFallback(datasetUrl, updated, fetch, snapshot.etag)
    ).rejects.toThrow('missing an ETag')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
