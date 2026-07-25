import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  createTrustCircleStore,
  deriveTrustCircleDocumentUrl,
  parseTrustCircleDocument,
} from './trustCirclePersistence'

function response(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (_name: string) => null,
    },
    text: async () => body,
  } as Response
}

function responseWithEtag(status: number, etag: string | null, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null),
    },
    text: async () => body,
  } as Response
}

void test('deriveTrustCircleDocumentUrl derives pod document URL from WebID', () => {
  assert.equal(
    deriveTrustCircleDocumentUrl('https://pod.example/alice/profile/card#me'),
    'https://pod.example/alice/backpack/preferences/trust-circle.json'
  )
})

void test('parseTrustCircleDocument parses legacy array and versioned document payloads', () => {
  assert.deepEqual(parseTrustCircleDocument('["b", "a", "a"]'), ['a', 'b'])
  assert.deepEqual(parseTrustCircleDocument('{"version":1,"members":["z","x"]}'), ['x', 'z'])
})

void test('list migrates local members to pod when pod document is missing', async () => {
  const ownerWebId = 'https://pod.example/alice/profile/card#me'
  const readLocal = async () => ['https://pod.example/bob#me']
  const writeLocal = async () => undefined
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let callIndex = 0
  const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    callIndex += 1
    return callIndex === 1 ? response(404) : response(201)
  }

  const store = createTrustCircleStore({ readLocal, writeLocal })
  const members = await store.list(ownerWebId, { fetch: fetchMock as typeof globalThis.fetch })

  assert.deepEqual(members, ['https://pod.example/bob#me'])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://pod.example/alice/backpack/preferences/trust-circle.json')
  assert.deepEqual(calls[0].init?.headers, { Accept: 'application/json' })
  assert.equal(calls[1].init?.method, 'PUT')
})

void test('list falls back to local members when pod read fails', async () => {
  const ownerWebId = 'https://pod.example/alice/profile/card#me'
  const readLocal = async () => ['https://pod.example/charlie#me']
  let writeLocalCalls = 0
  const writeLocal = async () => {
    writeLocalCalls += 1
  }
  const fetchMock = async () => {
    throw new Error('network down')
  }

  const store = createTrustCircleStore({ readLocal, writeLocal })
  const members = await store.list(ownerWebId, { fetch: fetchMock as typeof globalThis.fetch })

  assert.deepEqual(members, ['https://pod.example/charlie#me'])
  assert.equal(writeLocalCalls, 0)
})

void test('add/remove update local state and write to pod', async () => {
  const ownerWebId = 'https://pod.example/alice/profile/card#me'
  let localState: string[] = []
  let writeLocalCalls = 0
  const calls: Array<{ url: string; init?: RequestInit }> = []

  const readLocal = async () => localState
  const writeLocal = async (_owner: string, members: string[]) => {
    localState = [...members]
    writeLocalCalls += 1
  }
  const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (init?.method === 'PUT') return response(201)
    return responseWithEtag(404, null)
  }

  const store = createTrustCircleStore({ readLocal, writeLocal })

  await store.add(ownerWebId, 'https://pod.example/bob#me', {
    fetch: fetchMock as typeof globalThis.fetch,
  })
  assert.deepEqual(localState, ['https://pod.example/bob#me'])

  await store.remove(ownerWebId, 'https://pod.example/bob#me', {
    fetch: fetchMock as typeof globalThis.fetch,
  })
  assert.deepEqual(localState, [])
  assert.equal(writeLocalCalls, 2)
  assert.equal(calls.filter((entry) => entry.init?.method === 'PUT').length, 3)
})

void test('writePod merges members and retries once on ETag conflict', async () => {
  const ownerWebId = 'https://pod.example/alice/profile/card#me'
  let localState: string[] = []
  const writes: string[][] = []
  let readStep = 0
  let putStep = 0

  const readLocal = async () => localState
  const writeLocal = async (_owner: string, members: string[]) => {
    localState = [...members]
    writes.push([...members])
  }
  const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method !== 'PUT') {
      readStep += 1
      if (readStep === 1) {
        return responseWithEtag(200, 'W/"etag-v1"', '{"version":1,"members":["https://pod.example/alice#me"]}')
      }
      if (readStep === 2) {
        return responseWithEtag(200, 'W/"etag-v1"', '{"version":1,"members":["https://pod.example/alice#me"]}')
      }
      return responseWithEtag(
        200,
        'W/"etag-v2"',
        '{"version":1,"members":["https://pod.example/alice#me","https://pod.example/charlie#me"]}'
      )
    }

    putStep += 1
    if (putStep === 1) {
      return response(412)
    }
    return response(200)
  }

  const store = createTrustCircleStore({ readLocal, writeLocal })
  await store.add(ownerWebId, 'https://pod.example/bob#me', {
    fetch: fetchMock as typeof globalThis.fetch,
  })

  assert.deepEqual(localState, [
    'https://pod.example/alice#me',
    'https://pod.example/bob#me',
    'https://pod.example/charlie#me',
  ])
  assert.equal(writes.length >= 2, true)
})

void test('writePod merges members and retries once on 409 conflict', async () => {
  const ownerWebId = 'https://pod.example/alice/profile/card#me'
  let localState: string[] = []
  let readStep = 0
  let putStep = 0

  const readLocal = async () => localState
  const writeLocal = async (_owner: string, members: string[]) => {
    localState = [...members]
  }
  const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method !== 'PUT') {
      readStep += 1
      if (readStep <= 2) {
        return responseWithEtag(200, 'W/"etag-v1"', '{"version":1,"members":["https://pod.example/alice#me"]}')
      }
      return responseWithEtag(
        200,
        'W/"etag-v2"',
        '{"version":1,"members":["https://pod.example/alice#me","https://pod.example/delta#me"]}'
      )
    }

    putStep += 1
    if (putStep === 1) return response(409)
    return response(200)
  }

  const store = createTrustCircleStore({ readLocal, writeLocal })
  await store.add(ownerWebId, 'https://pod.example/bob#me', {
    fetch: fetchMock as typeof globalThis.fetch,
  })

  assert.deepEqual(localState, [
    'https://pod.example/alice#me',
    'https://pod.example/bob#me',
    'https://pod.example/delta#me',
  ])
})

void test('list reconciles stale local cache to pod state when pod document exists', async () => {
  const ownerWebId = 'https://pod.example/alice/profile/card#me'
  let localState: string[] = ['https://pod.example/stale#me']

  const readLocal = async () => localState
  const writeLocal = async (_owner: string, members: string[]) => {
    localState = [...members]
  }
  const fetchMock = async () =>
    responseWithEtag(
      200,
      'W/"etag-live"',
      '{"version":1,"members":["https://pod.example/fresh#me","https://pod.example/bob#me"]}'
    )

  const store = createTrustCircleStore({ readLocal, writeLocal })
  const members = await store.list(ownerWebId, { fetch: fetchMock as typeof globalThis.fetch })

  assert.deepEqual(members, ['https://pod.example/bob#me', 'https://pod.example/fresh#me'])
  assert.deepEqual(localState, ['https://pod.example/bob#me', 'https://pod.example/fresh#me'])
})

void test('add reconciles stale local cache against pod baseline before appending target', async () => {
  const ownerWebId = 'https://pod.example/alice/profile/card#me'
  let localState: string[] = ['https://pod.example/stale#me']
  let readStep = 0

  const readLocal = async () => localState
  const writeLocal = async (_owner: string, members: string[]) => {
    localState = [...members]
  }
  const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') return response(201)
    readStep += 1
    if (readStep === 1) {
      return responseWithEtag(200, 'W/"etag-v1"', '{"version":1,"members":["https://pod.example/fresh#me"]}')
    }
    return responseWithEtag(200, 'W/"etag-v1"', '{"version":1,"members":["https://pod.example/fresh#me","https://pod.example/new#me"]}')
  }

  const store = createTrustCircleStore({ readLocal, writeLocal })
  const result = await store.add(ownerWebId, 'https://pod.example/new#me', {
    fetch: fetchMock as typeof globalThis.fetch,
  })

  assert.deepEqual(result, ['https://pod.example/fresh#me', 'https://pod.example/new#me'])
  assert.deepEqual(localState, ['https://pod.example/fresh#me', 'https://pod.example/new#me'])
})
