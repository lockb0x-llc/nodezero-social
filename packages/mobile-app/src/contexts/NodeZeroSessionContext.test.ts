import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isProvisionerRequest } from '../auth/provisionerRequestPolicy'

void test('authorizes only the configured provisioner origin', () => {
  assert.equal(isProvisionerRequest(
    'https://api.nodezero.social/v1/community-directory/index',
    'https://api.nodezero.social'
  ), true)
  assert.equal(isProvisionerRequest(
    'https://solid.nodezero.social/alice/profile/card',
    'https://api.nodezero.social'
  ), false)
  assert.equal(isProvisionerRequest(
    'https://external.example/profile/card',
    'https://api.nodezero.social'
  ), false)
  assert.equal(isProvisionerRequest(
    'https://api.nodezero.social.evil.example/steal',
    'https://api.nodezero.social'
  ), false)
})