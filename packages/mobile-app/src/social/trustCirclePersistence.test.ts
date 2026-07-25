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

  const readLocal = async () => localState
  const writeLocal = async (_owner: string, members: string[]) => {
    localState = [...members]
    writeLocalCalls += 1
  }
  const fetchMock = async () => response(404)

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
})
