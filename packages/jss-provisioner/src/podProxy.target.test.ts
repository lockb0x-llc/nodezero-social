import assert from 'node:assert/strict'
import test from 'node:test'
import { PodProxyTargetError, buildPodProxyTarget } from './podProxy.js'

const cssBaseUrl = 'https://solid.nodezero.social/'
const podUrl = 'https://solid.nodezero.social/alice/'

void test('buildPodProxyTarget accepts resources inside the session Pod', () => {
  assert.equal(
    buildPodProxyTarget(cssBaseUrl, podUrl, 'alice/social/relationships/index?view=full'),
    'https://solid.nodezero.social/alice/social/relationships/index?view=full'
  )
})

void test('buildPodProxyTarget rejects sibling account paths', () => {
  assert.throws(
    () => buildPodProxyTarget(cssBaseUrl, podUrl, 'bob/social/inbox/'),
    (error: unknown) => error instanceof PodProxyTargetError && error.code === 'pod_scope_denied'
  )
})

void test('buildPodProxyTarget rejects raw and encoded path traversal', () => {
  for (const path of [
    'alice/../bob/',
    'alice/%2e%2e/bob/',
    'alice/%2Fbob/',
    'alice\\..\\bob',
  ]) {
    assert.throws(
      () => buildPodProxyTarget(cssBaseUrl, podUrl, path),
      (error: unknown) => error instanceof PodProxyTargetError && error.code === 'pod_path_invalid',
      path
    )
  }
})

void test('buildPodProxyTarget rejects a session Pod on another origin', () => {
  assert.throws(
    () => buildPodProxyTarget(
      cssBaseUrl,
      'https://pods.example/alice/',
      'alice/social/inbox/'
    ),
    (error: unknown) => error instanceof PodProxyTargetError && error.code === 'pod_origin_mismatch'
  )
})
