import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  AzureTableCommunityDirectoryPersistence,
  sanitizeCommunityDirectoryRecord,
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
      return Promise.resolve(
        new Response(
          JSON.stringify({
            value: [{ recordJson: JSON.stringify(record) }],
          }),
          { status: 200 }
        )
      )
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

void test('upsert sanitizes the persisted record payload at write time', async () => {
  let requestBody = ''
  let requestCount = 0
  const persistence = new AzureTableCommunityDirectoryPersistence(
    sasUrl,
    (_input, init): Promise<Response> => {
      requestCount += 1
      if (requestCount === 1) return Promise.resolve(new Response(null, { status: 404 }))
      requestBody = String(init?.body)
      return Promise.resolve(new Response(null, { status: 201 }))
    }
  )

  await persistence.upsertRecord({
    ...(record as Record<string, unknown>),
    clientCredentialsSecret: 'must not persist',
    blockedWebIds: ['must not persist'],
    publicInterests: ['must not persist'],
    capabilities: ['must not persist'],
    inboxUrl: 'https://solid.nodezero.social/alice/social/inbox/',
  } as unknown as typeof record)

  const entity = JSON.parse(requestBody) as { recordJson?: string }
  const persisted = JSON.parse(String(entity.recordJson)) as Record<string, unknown>
  assert.equal('clientCredentialsSecret' in persisted, false)
  assert.equal('blockedWebIds' in persisted, false)
  assert.equal('publicInterests' in persisted, false)
  assert.equal('capabilities' in persisted, false)
  assert.equal('inboxUrl' in persisted, false)
})

void test('stale opt-in cannot replace a newer opt-out', () => {
  const newerOptOut = {
    ...record,
    listed: false,
    publicationUpdatedAt: '2026-08-02T12:02:00.000Z',
    updatedAt: '2026-08-02T12:02:00.000Z',
  }
  const staleOptIn = {
    ...record,
    listed: true,
    publicationUpdatedAt: '2026-08-02T12:01:00.000Z',
    updatedAt: '2026-08-02T12:03:00.000Z',
  }
  assert.equal(shouldReplaceDirectoryRecord(newerOptOut, staleOptIn), false)
  assert.equal(shouldReplaceDirectoryRecord(staleOptIn, newerOptOut), true)
  assert.equal(
    shouldReplaceDirectoryRecord(
      { ...record, listed: true, publicationUpdatedAt: newerOptOut.publicationUpdatedAt },
      newerOptOut
    ),
    true
  )
})

void test('consent revision wins even when a device clock moves backwards', () => {
  const optIn = {
    ...record,
    publicationRevision: 4,
    publicationUpdatedAt: '2030-01-01T00:00:00.000Z',
  }
  const optOut = {
    ...record,
    listed: false,
    publicationRevision: 5,
    publicationUpdatedAt: '2020-01-01T00:00:00.000Z',
  }
  assert.equal(shouldReplaceDirectoryRecord(optIn, optOut), true)
  assert.equal(shouldReplaceDirectoryRecord(optOut, optIn), false)
})

void test('persisted rows are rebuilt from the explicit Directory allowlist', () => {
  const sanitized = sanitizeCommunityDirectoryRecord({
    ...record,
    displayName: 'Alice',
    bio: 'must not escape',
    publicInterests: ['must not escape'],
    capabilities: ['must not escape'],
    inboxUrl: 'https://solid.nodezero.social/alice/social/inbox/',
    clientCredentialsSecret: 'must not escape',
  })
  assert.equal(sanitized?.displayName, 'Alice')
  assert.equal('bio' in (sanitized ?? {}), false)
  assert.equal('publicInterests' in (sanitized ?? {}), false)
  assert.equal('capabilities' in (sanitized ?? {}), false)
  assert.equal('inboxUrl' in (sanitized ?? {}), false)
  assert.equal('clientCredentialsSecret' in (sanitized ?? {}), false)
})

void test('rejects a Directory SAS without read/add/update/delete permissions', () => {
  assert.throws(
    () =>
      new AzureTableCommunityDirectoryPersistence(
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
    publicationUpdatedAt: '2026-08-02T12:01:00.000Z',
  }
  const incomingOptOut = {
    ...record,
    listed: false,
    publicationUpdatedAt: '2026-08-02T12:02:00.000Z',
  }
  const persistence = new AzureTableCommunityDirectoryPersistence(
    sasUrl,
    (_input, init): Promise<Response> => {
      requestCount += 1
      if (!init?.method) {
        const current = requestCount === 1 ? storedOptIn : incomingOptOut
        return Promise.resolve(
          new Response(
            JSON.stringify({
              recordJson: JSON.stringify(current),
            }),
            { status: 200, headers: { etag: `"etag-${requestCount}"` } }
          )
        )
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
        return Promise.resolve(
          new Response(
            JSON.stringify({
              value: [{ recordJson: JSON.stringify(record) }],
            }),
            {
              status: 200,
              headers: {
                'x-ms-continuation-nextpartitionkey': 'nz-community-directory',
                'x-ms-continuation-nextrowkey': 'next-row',
              },
            }
          )
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            value: [{ recordJson: JSON.stringify(secondRecord) }],
          }),
          { status: 200 }
        )
      )
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
      return Promise.resolve(
        new Response(JSON.stringify({ readinessProbe: true }), {
          status: 200,
        })
      )
    }
  )

  await persistence.probe()
  assert.deepEqual(methods, ['POST', 'GET', 'DELETE'])
})
