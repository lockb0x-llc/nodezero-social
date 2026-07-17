import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Keypair } from '@stellar/stellar-sdk'
import { EnclaveAdapter, type ISecureStore } from './EnclaveAdapter.js'
import { WalletService } from './WalletService.js'

function createMemoryStore(initial: Record<string, string> = {}): ISecureStore {
  const store = new Map<string, string>(Object.entries(initial))

  return {
    getItemAsync(inputKey: string): Promise<string | null> {
      return Promise.resolve(store.get(inputKey) ?? null)
    },
    setItemAsync(key: string, value: string): Promise<void> {
      store.set(key, value)
      return Promise.resolve()
    },
    deleteItemAsync(key: string): Promise<void> {
      store.delete(key)
      return Promise.resolve()
    },
  }
}

void test('signAttestationChallenge produces a verifiable Ed25519 signature', async () => {
  const keypair = Keypair.random()
  const service = new WalletService(
    new EnclaveAdapter(createMemoryStore({ 'nodezero.stellar.secret': keypair.secret() }))
  )
  const payload = JSON.stringify({ nonce: 'abc123', stellarPublicKey: keypair.publicKey(), audience: 'nz-css-stellar-login-v1' })

  const result = await service.signAttestationChallenge(payload)

  assert.equal(result.stellarPublicKey, keypair.publicKey())
  assert.equal(result.challengePayload, payload)
  const valid = keypair.verify(Buffer.from(payload, 'utf8'), Buffer.from(result.signatureBase64, 'base64'))
  assert.equal(valid, true)
})

void test('signAttestationChallenge rejects an empty payload', async () => {
  const keypair = Keypair.random()
  const service = new WalletService(
    new EnclaveAdapter(createMemoryStore({ 'nodezero.stellar.secret': keypair.secret() }))
  )

  await assert.rejects(service.signAttestationChallenge('   '), /required/)
})

void test('signAttestationChallenge is deterministic for identical payloads', async () => {
  const keypair = Keypair.random()
  const service = new WalletService(
    new EnclaveAdapter(createMemoryStore({ 'nodezero.stellar.secret': keypair.secret() }))
  )
  const payload = 'NZ_TEST_PAYLOAD|stable'

  const first = await service.signAttestationChallenge(payload)
  const second = await service.signAttestationChallenge(payload)

  assert.equal(first.signatureBase64, second.signatureBase64)
})

void test('legacy single-slot secret is migrated to keyring and preserved', async () => {
  const keypair = Keypair.random()
  const service = new WalletService(
    new EnclaveAdapter(createMemoryStore({ 'nodezero.stellar.secret': keypair.secret() }))
  )

  const info = await service.getWalletInfo()

  assert.match(info.keyId, /^id-[a-f0-9]{16}$/)
  assert.equal(info.publicKey, keypair.publicKey())

  const activeKeyId = await service.getActiveIdentityKeyId()
  assert.equal(activeKeyId, info.keyId)

  const identities = await service.listIdentities()
  assert.equal(identities.length, 1)
  assert.equal(identities[0]?.keyId, info.keyId)
})

void test('supports creating and switching between identities', async () => {
  const keypair = Keypair.random()
  const service = new WalletService(
    new EnclaveAdapter(createMemoryStore({ 'nodezero.stellar.secret': keypair.secret() }))
  )

  const first = await service.getWalletInfo()
  const second = await service.createIdentity('Alt Identity')

  assert.notEqual(first.keyId, second.keyId)
  assert.notEqual(first.publicKey, second.publicKey)

  const identities = await service.listIdentities()
  assert.equal(identities.length, 2)
  assert.equal(identities.some((identity) => identity.keyId === first.keyId), true)
  assert.equal(identities.some((identity) => identity.keyId === second.keyId), true)

  await service.setActiveIdentity(first.keyId)
  const active = await service.getActiveIdentityKeyId()
  assert.equal(active, first.keyId)

  const restoredPublicKey = await service.getWalletPublicKey()
  assert.equal(restoredPublicKey, first.publicKey)

  const secondPublicKey = await service.getWalletPublicKeyForIdentity(second.keyId)
  assert.equal(secondPublicKey, second.publicKey)
})
