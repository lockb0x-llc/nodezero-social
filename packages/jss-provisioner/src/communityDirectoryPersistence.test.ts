import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  AzureTableCommunityDirectoryPersistence,
  shouldReplaceDirectoryRecord,
} from './communityDirectoryPersistence.js'

const sasUrl = 'https://storage.example/nzcredentials?sv=1&sp=raud&sig=signed'
const record = {
  webId: 'https://solid.nodezero.social/alice/profile/card#me',
  podUrl: 'https://solid.nodezero.social/alice/',
  issuer: 'https://solid.nodezero.social',
  listed: true,
  updatedAt: '2026-08-02T12:00:00.000Z',
}

void test('loads only the Community Directory partition', async () => {
  let requestUrl = ''
  const persistence = new AzureTableCommunityDirectoryPersistence(
    sasUrl,
    (input): Promise<Response> => {
      requestUrl = String(input)
      return Promise.resolve(new Response(JSON.stringify({
        value: [{ recordJson: JSON.stringify(record) }],
      }), { status: 200 }))
    }
  )

  assert.deepEqual(await persistence.loadRecords(), [record])
  assert.match(decodeURIComponent(requestUrl), /PartitionKey eq 'nz-community-directory'/)
  assert.doesNotMatch(requestUrl, /nz-solid-credentials/)
})

void test('upserts one hashed WebID row without credential fields', async () => {
  let requestBody = ''
  let requestUrl = ''
  let requestCount = 0
  const persistence = new AzureTableCommunityDirectoryPersistence(
    sasUrl,
    (input, init): Promise<Response> => {
      requestCount += 1
      requestUrl = String(input)
      if (requestCount === 1) return Promise.resolve(new Response(null, { status: 404 }))
      requestBody = String(init?.body)
      assert.equal(init?.method, 'POST')
      assert.equal(new Headers(init?.headers).get('prefer'), 'return-no-content')
      return Promise.resolve(new Response(null, { status: 201 }))
    }
  )

  await persistence.upsertRecord(record)
  assert.doesNotMatch(requestUrl, /PartitionKey='nz-community-directory'/)
  assert.doesNotMatch(requestUrl, /alice/)
  assert.equal(requestBody.includes('clientCredentialsSecret'), false)
  const entity = JSON.parse(requestBody) as { recordJson?: unknown }
  assert.equal(entity.recordJson, JSON.stringify(record))
})

void test('stale opt-in cannot replace a newer opt-out', () => {
  const newerOptOut = {
    ...record,
    listed: false,
    consentUpdatedAt: '2026-08-02T12:02:00.000Z',
    updatedAt: '2026-08-02T12:02:00.000Z',
  }
  const staleOptIn = {
    ...record,
    listed: true,
    consentUpdatedAt: '2026-08-02T12:01:00.000Z',
    updatedAt: '2026-08-02T12:03:00.000Z',
  }
  assert.equal(shouldReplaceDirectoryRecord(newerOptOut, staleOptIn), false)
  assert.equal(shouldReplaceDirectoryRecord(staleOptIn, newerOptOut), true)
  assert.equal(shouldReplaceDirectoryRecord(
    { ...record, listed: true, consentUpdatedAt: newerOptOut.consentUpdatedAt },
    newerOptOut
  ), true)
})

void test('rejects a Directory SAS without read/add/update/delete permissions', () => {
  assert.throws(
    () => new AzureTableCommunityDirectoryPersistence(
      'https://storage.example/nzcredentials?sv=1&sp=r&sig=signed'
    ),
    /read, add, update, and delete/
  )
})

void test('retries an ETag conflict and preserves the newer stored opt-out', async () => {
  let requestCount = 0
  const storedOptIn = {
    ...record,
    listed: true,
    consentUpdatedAt: '2026-08-02T12:01:00.000Z',
  }
  const incomingOptOut = {
    ...record,
    listed: false,
    consentUpdatedAt: '2026-08-02T12:02:00.000Z',
  }
  const persistence = new AzureTableCommunityDirectoryPersistence(
    sasUrl,
    (_input, init): Promise<Response> => {
      requestCount += 1
      if (!init?.method) {
        const current = requestCount === 1 ? storedOptIn : incomingOptOut
        return Promise.resolve(new Response(JSON.stringify({
          recordJson: JSON.stringify(current),
        }), { status: 200, headers: { etag: `"etag-${requestCount}"` } }))
      }
      return Promise.resolve(new Response(null, { status: 412 }))
    }
  )

  await persistence.upsertRecord(incomingOptOut)
  assert.equal(requestCount, 3)
})

void test('follows Azure Table continuation tokens until the partition is exhausted', async () => {
  const requestUrls: string[] = []
  const secondRecord = { ...record, webId: 'https://solid.nodezero.social/bob/profile/card#me' }
  const persistence = new AzureTableCommunityDirectoryPersistence(
    sasUrl,
    (input): Promise<Response> => {
      const requestUrl = String(input)
      requestUrls.push(requestUrl)
      if (requestUrls.length === 1) {
        return Promise.resolve(new Response(JSON.stringify({
          value: [{ recordJson: JSON.stringify(record) }],
        }), {
          status: 200,
          headers: {
            'x-ms-continuation-nextpartitionkey': 'nz-community-directory',
            'x-ms-continuation-nextrowkey': 'next-row',
          },
        }))
      }
      return Promise.resolve(new Response(JSON.stringify({
        value: [{ recordJson: JSON.stringify(secondRecord) }],
      }), { status: 200 }))
    }
  )

  assert.deepEqual(await persistence.loadRecords(), [record, secondRecord])
  assert.equal(requestUrls.length, 2)
  assert.match(requestUrls[1] ?? '', /NextPartitionKey=nz-community-directory/)
  assert.match(requestUrls[1] ?? '', /NextRowKey=next-row/)
})

void test('readiness probe proves create, read, and delete capability', async () => {
  const methods: string[] = []
  const persistence = new AzureTableCommunityDirectoryPersistence(
    sasUrl,
    (_input, init): Promise<Response> => {
      const method = init?.method ?? 'GET'
      methods.push(method)
      if (method === 'POST') return Promise.resolve(new Response(null, { status: 201 }))
      if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
      return Promise.resolve(new Response(JSON.stringify({ readinessProbe: true }), {
        status: 200,
      }))
    }
  )

  await persistence.probe()
  assert.deepEqual(methods, ['POST', 'GET', 'DELETE'])
})
