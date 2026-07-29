import { strict as assert } from 'node:assert'
import { webcrypto } from 'node:crypto'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbSecureStore, IndexedDbStorageError } from './IndexedDbSecureStore.js'

function createStore(indexedDB: IDBFactory, profile = 'staging-testnet'): IndexedDbSecureStore {
  return new IndexedDbSecureStore({
    profile,
    databaseName: `wallet-${profile}`,
    indexedDB,
    crypto: webcrypto as unknown as Crypto,
  })
}

async function readRawRecord(indexedDB: IDBFactory, databaseName: string, key: string): Promise<unknown> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const result = await new Promise<unknown>((resolve, reject) => {
    const request = database.transaction('records', 'readonly').objectStore('records').get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  database.close()
  return result
}

void test('persists encrypted records across store instances', async () => {
  const indexedDB = new IDBFactory()
  const first = createStore(indexedDB)
  await first.setItemAsync('secret', 'SENSITIVE-WALLET-SECRET')
  await first.close()

  const second = createStore(indexedDB)
  assert.equal(await second.getItemAsync('secret'), 'SENSITIVE-WALLET-SECRET')
  const raw = await readRawRecord(indexedDB, second.databaseName, 'secret')
  assert.ok(raw)
  assert.equal(JSON.stringify(raw).includes('SENSITIVE-WALLET-SECRET'), false)
  await second.close()
})

void test('uses a unique IV for each encrypted write', async () => {
  const indexedDB = new IDBFactory()
  const store = createStore(indexedDB)
  await store.setItemAsync('first', 'same-value')
  await store.setItemAsync('second', 'same-value')
  const first = await readRawRecord(indexedDB, store.databaseName, 'first') as { iv: ArrayBuffer }
  const second = await readRawRecord(indexedDB, store.databaseName, 'second') as { iv: ArrayBuffer }
  assert.notDeepEqual([...new Uint8Array(first.iv)], [...new Uint8Array(second.iv)])
  await store.close()
})

void test('fails closed when ciphertext is tampered', async () => {
  const indexedDB = new IDBFactory()
  const store = createStore(indexedDB)
  await store.setItemAsync('secret', 'wallet-secret')
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(store.databaseName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const transaction = database.transaction('records', 'readwrite')
  const objectStore = transaction.objectStore('records')
  const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = objectStore.get('secret')
    request.onsuccess = () => resolve(request.result as Record<string, unknown>)
    request.onerror = () => reject(request.error)
  })
  const ciphertext = new Uint8Array(record.ciphertext as ArrayBuffer)
  ciphertext[0] ^= 0xff
  objectStore.put({ ...record, ciphertext: ciphertext.buffer })
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()

  await assert.rejects(
    store.getItemAsync('secret'),
    (error: unknown) => error instanceof IndexedDbStorageError && error.code === 'storage_corrupt',
  )
  await store.close()
})

void test('deletes records and isolates profile databases', async () => {
  const indexedDB = new IDBFactory()
  const staging = createStore(indexedDB)
  const production = createStore(indexedDB, 'production-mainnet')
  await staging.setItemAsync('secret', 'staging-secret')
  assert.equal(await production.getItemAsync('secret'), null)
  await staging.deleteItemAsync('secret')
  assert.equal(await staging.getItemAsync('secret'), null)
  await staging.close()
  await production.close()
})