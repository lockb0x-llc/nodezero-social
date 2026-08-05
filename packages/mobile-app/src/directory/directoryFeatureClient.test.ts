import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { NO_DIRECTORY_FEATURES, readDirectoryFeatureAvailability } from './directoryFeatureClient'

void test('reads session-bound feature availability from the provisioner', async () => {
  let requestUrl = ''
  const result = await readDirectoryFeatureAvailability(
    'https://api.nodezero.example/',
    (input, init): Promise<Response> => {
      requestUrl = String(input)
      assert.equal(new Headers(init?.headers).get('accept'), 'application/json')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            version: 1,
            features: {
              directory: true,
              peerProfile: false,
              relationship: false,
              transport: false,
            },
          }),
          { status: 200 }
        )
      )
    }
  )
  assert.equal(requestUrl, 'https://api.nodezero.example/v1/milestone-q/features')
  assert.deepEqual(result, {
    directory: true,
    peerProfile: false,
    relationship: false,
    transport: false,
  })
})

void test('fails closed for unavailable or malformed feature documents', async () => {
  assert.deepEqual(
    await readDirectoryFeatureAvailability('', async () => new Response()),
    NO_DIRECTORY_FEATURES
  )
  assert.deepEqual(
    await readDirectoryFeatureAvailability(
      'https://api.nodezero.example',
      async () => new Response(JSON.stringify({ version: 1, features: { directory: true } }))
    ),
    NO_DIRECTORY_FEATURES
  )
  assert.deepEqual(
    await readDirectoryFeatureAvailability(
      'https://api.nodezero.example',
      async () => new Response('{}', { status: 404 })
    ),
    NO_DIRECTORY_FEATURES
  )
})
