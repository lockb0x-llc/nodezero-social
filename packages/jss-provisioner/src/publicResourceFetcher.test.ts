import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PublicResourceFetchError,
  createCredentialFreePublicFetch,
  fetchPublicResource,
  isBlockedAddress,
  parsePublicUrl,
  postPublicResource,
} from './publicResourceFetcher.js'

const publicResolver = (): Promise<Array<{ address: string; family: 4 }>> =>
  Promise.resolve([{ address: '93.184.216.34', family: 4 }])

void test('parsePublicUrl rejects unsafe protocols, credentials, ports, and direct private hosts', () => {
  assert.throws(
    () => parsePublicUrl('http://example.com/profile'),
    (error: unknown) => error instanceof PublicResourceFetchError && error.code === 'invalid_protocol'
  )
  assert.throws(() => parsePublicUrl('https://user:pass@example.com/profile'))
  assert.throws(() => parsePublicUrl('https://example.com:8443/profile'))
  assert.throws(() => parsePublicUrl('https://127.0.0.1/profile'))
  assert.throws(() => parsePublicUrl('https://169.254.169.254/latest/meta-data'))
  assert.equal(parsePublicUrl('https://example.com/profile#me').toString(), 'https://example.com/profile')
})

void test('isBlockedAddress covers private, carrier-grade NAT, mapped IPv4, and local IPv6', () => {
  for (const address of [
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ]) {
    assert.equal(isBlockedAddress(address), true, address)
  }
  assert.equal(isBlockedAddress('93.184.216.34'), false)
  assert.equal(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946'), false)
})

void test('fetchPublicResource pins validated DNS addresses into each request', async () => {
  let capturedAddress = ''
  const response = await fetchPublicResource('https://example.com/profile/card#me', {
    resolveHost: publicResolver as never,
    requestOnce: (input) => {
      capturedAddress = input.addresses[0]?.address ?? ''
      return Promise.resolve({
        status: 200,
        headers: {
          'content-type': 'text/turtle; charset=utf-8',
          etag: '"profile-1"',
          link: '<https://example.com/inbox/>; rel="http://www.w3.org/ns/ldp#inbox"',
        },
        body: Buffer.from('<https://example.com/profile/card#me> a <http://xmlns.com/foaf/0.1/Person> .'),
      })
    },
  })

  assert.equal(capturedAddress, '93.184.216.34')
  assert.equal(response.finalUrl, 'https://example.com/profile/card')
  assert.equal(response.contentType, 'text/turtle')
  assert.equal(response.etag, '"profile-1"')
  assert.match(response.link ?? '', /ldp#inbox/)
})

void test('fetchPublicResource revalidates redirect targets and blocks private DNS answers', async () => {
  let requests = 0
  const resolver = (hostname: string): Promise<Array<{ address: string; family: 4 }>> => {
    if (hostname === 'example.com') return Promise.resolve([{ address: '93.184.216.34', family: 4 }])
    return Promise.resolve([{ address: '127.0.0.1', family: 4 }])
  }

  await assert.rejects(
    fetchPublicResource('https://example.com/profile', {
      resolveHost: resolver as never,
      requestOnce: () => {
        requests += 1
        return Promise.resolve({
          status: 302,
          headers: { location: 'https://internal.example/profile' },
          body: Buffer.alloc(0),
        })
      },
    }),
    (error: unknown) => error instanceof PublicResourceFetchError && error.code === 'blocked_host'
  )
  assert.equal(requests, 1)
})

void test('fetchPublicResource rejects unsupported, empty, oversized, and excessive redirect responses', async () => {
  const baseOptions = { resolveHost: publicResolver as never }
  await assert.rejects(
    fetchPublicResource('https://example.com/profile', {
      ...baseOptions,
      requestOnce: () => Promise.resolve({
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from('<html></html>'),
      }),
    }),
    (error: unknown) => error instanceof PublicResourceFetchError && error.code === 'unsupported_content_type'
  )
  await assert.rejects(
    fetchPublicResource('https://example.com/profile', {
      ...baseOptions,
      requestOnce: () => Promise.resolve({
        status: 200,
        headers: { 'content-type': 'text/turtle' },
        body: Buffer.alloc(0),
      }),
    }),
    (error: unknown) => error instanceof PublicResourceFetchError && error.code === 'empty_payload'
  )
  await assert.rejects(
    fetchPublicResource('https://example.com/profile', {
      ...baseOptions,
      maxBytes: 4,
      requestOnce: () => Promise.resolve({
        status: 200,
        headers: { 'content-type': 'application/ld+json' },
        body: Buffer.from('12345'),
      }),
    }),
    (error: unknown) => error instanceof PublicResourceFetchError && error.code === 'payload_too_large'
  )
  await assert.rejects(
    fetchPublicResource('https://example.com/profile', {
      ...baseOptions,
      maxRedirects: 0,
      requestOnce: () => Promise.resolve({
        status: 302,
        headers: { location: 'https://example.com/other' },
        body: Buffer.alloc(0),
      }),
    }),
    (error: unknown) => error instanceof PublicResourceFetchError && error.code === 'too_many_redirects'
  )
})

void test('public request contract has no authorization or caller-controlled header input', async () => {
  let inputKeys: string[] = []
  await fetchPublicResource('https://example.com/profile', {
    resolveHost: publicResolver as never,
    requestOnce: (input) => {
      inputKeys = Object.keys(input).sort()
      return Promise.resolve({
        status: 200,
        headers: { 'content-type': 'application/ld+json' },
        body: Buffer.from('{}'),
      })
    },
  })
  assert.deepEqual(inputKeys, ['addresses', 'maxBytes', 'timeoutMs', 'url', 'userAgent'])
})

void test('credential-free public fetch rejects non-GET methods and preserves response URL', async () => {
  const publicFetch = createCredentialFreePublicFetch({
    resolveHost: publicResolver as never,
    requestOnce: () => Promise.resolve({
      status: 200,
      headers: { 'content-type': 'text/turtle' },
      body: Buffer.from('<#me> a <https://example.test/Person> .'),
    }),
  })
  const response = await publicFetch('https://example.com/profile/card')
  assert.equal(response.url, 'https://example.com/profile/card')
  await assert.rejects(
    publicFetch('https://example.com/profile/card', { method: 'POST' }),
    (error: unknown) => error instanceof PublicResourceFetchError && error.code === 'method_not_allowed'
  )
})

void test('postPublicResource sends no authorization input and accepts 201 delivery', async () => {
  let inputKeys: string[] = []
  const result = await postPublicResource(
    'https://example.com/inbox/',
    Buffer.from('{"type":"Follow"}'),
    'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
    {
      resolveHost: publicResolver as never,
      requestOnce: (input) => {
        inputKeys = Object.keys(input).sort()
        return Promise.resolve({
          status: 201,
          headers: { location: '/inbox/activity-1' },
          body: Buffer.alloc(0),
        })
      },
    }
  )
  assert.deepEqual(inputKeys, [
    'addresses',
    'body',
    'contentType',
    'maxResponseBytes',
    'timeoutMs',
    'url',
    'userAgent',
  ])
  assert.equal(result.status, 201)
  assert.equal(result.location, 'https://example.com/inbox/activity-1')
})

void test('postPublicResource follows only revalidated 307/308 redirects', async () => {
  let requests = 0
  const result = await postPublicResource(
    'https://example.com/inbox/',
    Buffer.from('{}'),
    'application/ld+json',
    {
      resolveHost: publicResolver as never,
      requestOnce: () => {
        requests += 1
        return Promise.resolve(
          requests === 1
            ? { status: 307, headers: { location: 'https://example.com/inbox-v2/' }, body: Buffer.alloc(0) }
            : { status: 202, headers: {}, body: Buffer.alloc(0) }
        )
      },
    }
  )
  assert.equal(result.finalUrl, 'https://example.com/inbox-v2/')
  assert.equal(requests, 2)

  await assert.rejects(
    postPublicResource(
      'https://example.com/inbox/',
      Buffer.from('{}'),
      'application/ld+json',
      {
        resolveHost: publicResolver as never,
        requestOnce: () => Promise.resolve({
          status: 302,
          headers: { location: 'https://example.com/other' },
          body: Buffer.alloc(0),
        }),
      }
    ),
    (error: unknown) => error instanceof PublicResourceFetchError && error.code === 'unsafe_redirect_status'
  )
})
