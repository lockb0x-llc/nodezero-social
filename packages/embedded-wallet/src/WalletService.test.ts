import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Keypair } from '@stellar/stellar-sdk'
import { EnclaveAdapter, type ISecureStore } from './EnclaveAdapter.js'
import { WalletService } from './WalletService.js'

function createFixedStore(secret: string): ISecureStore {
  const key = 'nodezero.stellar.secret'
  return {
    async getItemAsync(inputKey: string): Promise<string | null> {
      return inputKey === key ? secret : null
    },
    async setItemAsync(): Promise<void> {
      return
    },
    async deleteItemAsync(): Promise<void> {
      return
    },
  }
}

void test('signAttestationChallenge produces a verifiable Ed25519 signature', async () => {
  const keypair = Keypair.random()
  const service = new WalletService(new EnclaveAdapter(createFixedStore(keypair.secret())))
  const payload = JSON.stringify({ nonce: 'abc123', stellarPublicKey: keypair.publicKey(), audience: 'nz-css-stellar-login-v1' })

  const result = await service.signAttestationChallenge(payload)

  assert.equal(result.stellarPublicKey, keypair.publicKey())
  assert.equal(result.challengePayload, payload)
  const valid = keypair.verify(Buffer.from(payload, 'utf8'), Buffer.from(result.signatureBase64, 'base64'))
  assert.equal(valid, true)
})

void test('signAttestationChallenge rejects an empty payload', async () => {
  const keypair = Keypair.random()
  const service = new WalletService(new EnclaveAdapter(createFixedStore(keypair.secret())))

  await assert.rejects(service.signAttestationChallenge('   '), /required/)
})

void test('signAttestationChallenge is deterministic for identical payloads', async () => {
  const keypair = Keypair.random()
  const service = new WalletService(new EnclaveAdapter(createFixedStore(keypair.secret())))
  const payload = 'NZ_TEST_PAYLOAD|stable'

  const first = await service.signAttestationChallenge(payload)
  const second = await service.signAttestationChallenge(payload)

  assert.equal(first.signatureBase64, second.signatureBase64)
})
