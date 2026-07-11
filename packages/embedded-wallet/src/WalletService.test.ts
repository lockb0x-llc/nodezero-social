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

void test('deriveBootstrapPassword is deterministic for same wallet and inputs', async () => {
  const keypair = Keypair.random()
  const service = new WalletService(new EnclaveAdapter(createFixedStore(keypair.secret())))
  const input = {
    issuer: 'https://solid.nodezero.social/',
    handle: 'alice',
    notificationEmail: 'alice@example.com',
    stellarPublicKey: keypair.publicKey(),
  }

  const first = await service.deriveBootstrapPassword(input)
  const second = await service.deriveBootstrapPassword(input)

  assert.equal(first, second)
  assert.ok(first.startsWith('Nz!'))
  assert.ok(first.length >= 20)
})

void test('deriveBootstrapPassword changes when canonical input changes', async () => {
  const keypair = Keypair.random()
  const service = new WalletService(new EnclaveAdapter(createFixedStore(keypair.secret())))

  const first = await service.deriveBootstrapPassword({
    issuer: 'https://solid.nodezero.social/',
    handle: 'alice',
    notificationEmail: 'alice@example.com',
    stellarPublicKey: keypair.publicKey(),
  })

  const second = await service.deriveBootstrapPassword({
    issuer: 'https://solid.nodezero.social/',
    handle: 'alice2',
    notificationEmail: 'alice@example.com',
    stellarPublicKey: keypair.publicKey(),
  })

  assert.notEqual(first, second)
})

void test('deriveBootstrapPassword rejects mismatched public key', async () => {
  const keypair = Keypair.random()
  const otherKeypair = Keypair.random()
  const service = new WalletService(new EnclaveAdapter(createFixedStore(keypair.secret())))

  await assert.rejects(
    service.deriveBootstrapPassword({
      issuer: 'https://solid.nodezero.social/',
      handle: 'alice',
      notificationEmail: 'alice@example.com',
      stellarPublicKey: otherKeypair.publicKey(),
    }),
    /does not match local wallet/,
  )
})
