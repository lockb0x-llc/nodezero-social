import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseDirectoryRecords, resolveDirectoryEndpointFromExtra } from './directorySourceShared'

void test('resolveDirectoryEndpointFromExtra prefers explicit directory URL override', () => {
  const endpoint = resolveDirectoryEndpointFromExtra({
    nodeZeroIssuerUrl: 'https://staging.nodezero.social',
    nodeZeroDirectoryUrl: 'https://override.example/directory.json',
  })

  assert.equal(endpoint, 'https://override.example/directory.json')
})

void test('resolveDirectoryEndpointFromExtra defaults to provisioner community directory index', () => {
  const endpoint = resolveDirectoryEndpointFromExtra({
    nodeZeroIssuerUrl: 'https://staging.nodezero.social/',
  })

  assert.equal(endpoint, 'https://staging.nodezero.social/v1/community-directory/index')
})

void test('parseDirectoryRecords reads members payload and filters invalid webIds', () => {
  const parsed = parseDirectoryRecords({
    version: 1,
    members: [
      {
        webId: 'https://solid.nodezero.social/alice/profile/card#me',
        listed: true,
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
})
