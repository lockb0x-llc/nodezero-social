import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  buildDirectoryPageUrl,
  parseDirectoryPage,
  parseDirectoryRecords,
  resolveDirectoryEndpointFromExtra,
} from './directorySourceShared'

void test('resolveDirectoryEndpointFromExtra prefers explicit directory URL override', () => {
  const endpoint = resolveDirectoryEndpointFromExtra({
    nodeZeroIssuerUrl: 'https://staging.nodezero.social',
    nodeZeroDirectoryUrl: 'https://override.example/directory.json',
  })

  assert.equal(endpoint, 'https://override.example/directory.json')
})

void test('resolveDirectoryEndpointFromExtra defaults to provisioner community directory index', () => {
  const endpoint = resolveDirectoryEndpointFromExtra({
    jssProvisionerUrl: 'https://api.nodezero.social/',
  })

  assert.equal(endpoint, 'https://api.nodezero.social/v1/community-directory/index')
})

void test('parseDirectoryRecords reads members payload and filters invalid webIds', () => {
  const parsed = parseDirectoryRecords({
    version: 1,
    members: [
      {
        webId: 'https://solid.nodezero.social/alice/profile/card#me',
        listed: true,
        publicInterests: ['solid', 'privacy'],
        capabilities: ['relationship-requests'],
        sourceRevision: '"manifest-v1"',
        trustSignals: { verified: true },
      },
      {
        webId: 'http://invalid.example/profile/card#me',
      },
    ],
  })

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]?.webId, 'https://solid.nodezero.social/alice/profile/card#me')
  assert.equal(parsed[0]?.listed, true)
  assert.equal(parsed[0]?.trustSignals?.verified, true)
  assert.deepEqual(parsed[0]?.publicInterests, ['solid', 'privacy'])
  assert.deepEqual(parsed[0]?.capabilities, ['relationship-requests'])
  assert.equal(parsed[0]?.sourceRevision, '"manifest-v1"')
})

void test('parseDirectoryPage preserves cursor and response ETag', () => {
  const page = parseDirectoryPage({
    version: 1,
    members: [{ webId: 'https://solid.nodezero.social/alice/profile/card#me' }],
    nextCursor: 'https://solid.nodezero.social/alice/profile/card#me',
  }, 'W/"page-v1"')

  assert.equal(page.members.length, 1)
  assert.equal(page.nextCursor, 'https://solid.nodezero.social/alice/profile/card#me')
  assert.equal(page.etag, 'W/"page-v1"')
})

void test('buildDirectoryPageUrl bounds limit and encodes cursor', () => {
  const url = new URL(buildDirectoryPageUrl(
    'https://api.nodezero.social/v1/community-directory/index',
    { cursor: 'https://solid.example/alice/profile/card#me', limit: 500 }
  ))
  assert.equal(url.searchParams.get('limit'), '100')
  assert.equal(url.searchParams.get('cursor'), 'https://solid.example/alice/profile/card#me')
})
