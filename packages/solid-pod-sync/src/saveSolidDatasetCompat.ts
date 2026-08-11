import {
  getSolidDataset,
  getSourceUrl,
  saveSolidDatasetAt,
  solidDatasetAsTurtle,
  type SolidDataset,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'

export interface SolidDatasetSnapshot {
  dataset: SolidDataset & WithServerResourceInfo
  etag: string | null
}

export async function getSolidDatasetSnapshot(
  datasetUrl: string,
  fetchImpl: typeof globalThis.fetch
): Promise<SolidDatasetSnapshot> {
  let etag: string | null = null
  const observedFetch: typeof globalThis.fetch = async (input, init) => {
    const response = await fetchImpl(input, init)
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if ((init?.method ?? 'GET').toUpperCase() === 'GET' && target === datasetUrl && response.ok) {
      etag = response.headers.get('etag')
    }
    return response
  }
  const dataset = await getSolidDataset(datasetUrl, { fetch: observedFetch })
  return { dataset, etag }
}

export async function saveSolidDatasetWithPatchFallback(
  datasetUrl: string,
  dataset: SolidDataset,
  fetchImpl: typeof globalThis.fetch,
  etag: string | null,
  mutationHeaders: Record<string, string> = {}
): Promise<void> {
  if (getSourceUrl(dataset) && !etag) {
    throw new Error('Solid dataset is missing an ETag; refusing an unsafe update.')
  }
  const compatibleFetch: typeof globalThis.fetch = async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    for (const [name, value] of Object.entries(mutationHeaders)) headers.set(name, value)
    if (method === 'PATCH' && etag) headers.set('if-match', etag)
    if (method === 'PUT' && !etag) headers.set('if-none-match', '*')
    const guardedInit = { ...init, method, headers }
    const response = await fetchImpl(input, guardedInit)
    if (method !== 'PATCH' || ![405, 415, 501].includes(response.status)) {
      return response
    }
    if (!etag) throw new Error('Solid dataset is missing an ETag; refusing an unsafe replacement.')
    return fetchImpl(input, {
      method: 'PUT',
      headers: {
        'content-type': 'text/turtle',
        'if-match': etag,
        ...mutationHeaders,
      },
      body: await solidDatasetAsTurtle(dataset),
    })
  }
  await saveSolidDatasetAt(datasetUrl, dataset, { fetch: compatibleFetch })
}
