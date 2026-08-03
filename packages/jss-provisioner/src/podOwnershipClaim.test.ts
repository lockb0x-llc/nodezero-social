import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPodOwnershipClaim as buildProvisionerClaim } from './podOwnershipClaim.js'
import { buildPodOwnershipClaim as buildZkClaim } from '../../zk-crypto/src/pod-ownership-claim.js'

const claim = {
  circuitVersion: 3,
  envProfile: ' staging-testnet ',
  stellarNetworkPassphrase: 'Test SDF Network ; September 2015',
  webId: 'https://solid.nodezero.social/alice/profile/card#me',
  podUrl: ' https://solid.nodezero.social/alice ',
  stellarPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  identityContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
  lockboxFactoryContractId: 'CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAG4',
  challengeId: 'nz-seamless-v1',
  nonce: 'nz-seamless-v1',
  expiresAt: 'nz-seamless-v1',
  configFingerprint: 'f'.repeat(64),
}

void test('provisioner bridge claim remains byte-identical to the ZK implementation', () => {
  assert.equal(buildProvisionerClaim(claim), buildZkClaim(claim))
})

void test('provisioner bridge claim rejects a missing V3 configuration fingerprint', () => {
  const invalidClaim = { ...claim, configFingerprint: undefined }
  assert.throws(() => buildProvisionerClaim(invalidClaim), /configuration fingerprint/)
})
