import assert from 'node:assert/strict'
import { test } from 'node:test'
import { podProxyAuditDigest } from './podProxy.js'

void test('Pod proxy audit digests are deterministic, domain-separated, and irreversible in logs', () => {
  const webId = 'https://solid.nodezero.social/alice/profile/card#me'
  const target = 'https://solid.nodezero.social/alice/private/messages.ttl?secret=value'
  const identityDigest = podProxyAuditDigest('identity', webId)
  const resourceDigest = podProxyAuditDigest('resource', target)

  assert.match(identityDigest, /^[0-9a-f]{64}$/)
  assert.match(resourceDigest, /^[0-9a-f]{64}$/)
  assert.equal(identityDigest, podProxyAuditDigest('identity', webId))
  assert.notEqual(identityDigest, podProxyAuditDigest('resource', webId))
  assert.notEqual(identityDigest, podProxyAuditDigest('error', webId))
  assert.equal(identityDigest.includes('alice'), false)
  assert.equal(resourceDigest.includes('messages'), false)
})
