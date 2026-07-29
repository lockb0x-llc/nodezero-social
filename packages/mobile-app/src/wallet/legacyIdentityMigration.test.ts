import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Keypair } from '@stellar/stellar-sdk'
import {
  legacyIdentitiesMissingFromBroker,
  readLegacyIdentityCandidates,
  removeMigratedLegacyIdentity,
} from './legacyIdentityMigration.js'

function createStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    storage: {
      getItem(key: string): string | null {
        return values.get(key) ?? null
      },
      setItem(key: string, value: string): void {
        values.set(key, value)
      },
      removeItem(key: string): void {
        values.delete(key)
      },
    },
  }
}

void test('discovers prefixed keyring and old single-slot identities', () => {
  const keyring = Keypair.random()
  const single = Keypair.random()
  const keyId = 'id-legacy'
  const { storage } = createStorage({
    'nodezero.embedded-wallet.nodezero.stellar.keyring.index.v1': JSON.stringify({
      version: 1,
      keyIds: [keyId],
    }),
    [`nodezero.embedded-wallet.nodezero.stellar.identity.meta.${keyId}`]: JSON.stringify({
      keyId,
      label: 'Original identity',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
    }),
    [`nodezero.embedded-wallet.nodezero.stellar.secret.${keyId}`]: keyring.secret(),
    'nodezero.stellar.secret': single.secret(),
  })

  const candidates = readLegacyIdentityCandidates(storage)

  assert.deepEqual(
    candidates.map((candidate) => candidate.stellarPublicKey).sort(),
    [keyring.publicKey(), single.publicKey()].sort(),
  )
  assert.equal(candidates.find((candidate) => candidate.sourceKeyId === keyId)?.label, 'Original identity')
})

void test('filters broker duplicates and removes only verified migrated entries', () => {
  const first = Keypair.random()
  const second = Keypair.random()
  const firstId = 'id-first'
  const secondId = 'id-second'
  const indexKey = 'nodezero.embedded-wallet.nodezero.stellar.keyring.index.v1'
  const activeKey = 'nodezero.embedded-wallet.nodezero.stellar.active-key-id.v1'
  const { storage, values } = createStorage({
    [indexKey]: JSON.stringify({ version: 1, keyIds: [firstId, secondId] }),
    [activeKey]: firstId,
    [`nodezero.embedded-wallet.nodezero.stellar.identity.meta.${firstId}`]: JSON.stringify({ label: 'First' }),
    [`nodezero.embedded-wallet.nodezero.stellar.secret.${firstId}`]: first.secret(),
    [`nodezero.embedded-wallet.nodezero.stellar.identity.meta.${secondId}`]: JSON.stringify({ label: 'Second' }),
    [`nodezero.embedded-wallet.nodezero.stellar.secret.${secondId}`]: second.secret(),
  })
  const candidates = readLegacyIdentityCandidates(storage)
  const missing = legacyIdentitiesMissingFromBroker(candidates, [
    {
      keyId: 'broker-existing',
      label: 'Existing',
      createdAt: '',
      lastUsedAt: null,
      stellarPublicKey: second.publicKey(),
      secretAvailable: true,
      active: true,
    },
  ])

  assert.deepEqual(missing.map((candidate) => candidate.stellarPublicKey), [first.publicKey()])
  const candidate = missing[0]
  assert.ok(candidate)
  removeMigratedLegacyIdentity(storage, candidate)

  assert.equal(values.has(`nodezero.embedded-wallet.nodezero.stellar.secret.${firstId}`), false)
  assert.equal(values.has(`nodezero.embedded-wallet.nodezero.stellar.secret.${secondId}`), true)
  const persistedIndex = JSON.parse(values.get(indexKey) ?? '{}') as { keyIds?: unknown }
  assert.deepEqual(persistedIndex.keyIds, [secondId])
  assert.equal(values.get(activeKey), secondId)
})
