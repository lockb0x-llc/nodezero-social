import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { resolveAclContainerUrl, resolvePodRootFromSession } from './aclUrl'

void test('resolvePodRootFromSession prefers explicit podUrl', () => {
  const root = resolvePodRootFromSession(
    'https://solid.nodezero.social/alice/',
    'https://solid.nodezero.social/bob/profile/card#me',
  )

  assert.equal(root, 'https://solid.nodezero.social/alice/')
})

void test('resolvePodRootFromSession derives pod root from webId', () => {
  const root = resolvePodRootFromSession(null, 'https://solid.nodezero.social/alice/profile/card#me')
  assert.equal(root, 'https://solid.nodezero.social/alice/')
})

void test('resolveAclContainerUrl builds absolute profile ACL container URL', () => {
  const url = resolveAclContainerUrl('profile', null, 'https://solid.nodezero.social/alice/profile/card#me')
  assert.equal(url, 'https://solid.nodezero.social/alice/profile/')
})

void test('resolveAclContainerUrl returns null when pod root cannot be resolved', () => {
  const url = resolveAclContainerUrl('location', null, null)
  assert.equal(url, null)
})
