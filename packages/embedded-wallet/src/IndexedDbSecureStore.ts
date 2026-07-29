import type { ISecureStore } from './EnclaveAdapter.js'

const DATABASE_VERSION = 1
const RECORD_STORE = 'records'
const KEY_STORE = 'keys'
const WRAPPING_KEY_ID = 'wallet-records-v1'

interface EncryptedRecord {
  key: string
  schemaVersion: 1
  profile: string
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
}

interface StoredWrappingKey {
  id: string
  key: CryptoKey
}

export class IndexedDbStorageError extends Error {
  readonly code: 'storage_unavailable' | 'storage_corrupt' | 'profile_mismatch'

  constructor(
    code: IndexedDbStorageError['code'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'IndexedDbStorageError'
    this.code = code
  }
}

export interface IndexedDbSecureStoreOptions {
  profile: string
  databaseName?: string
  indexedDB?: IDBFactory
  crypto?: Crypto
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result)
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = (): void => resolve()
    transaction.onabort = (): void => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
    transaction.onerror = (): void => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
  })
}

export class IndexedDbSecureStore implements ISecureStore {
  readonly databaseName: string
  private readonly profile: string
  private readonly indexedDbFactory: IDBFactory
  private readonly cryptoProvider: Crypto
  private databasePromise: Promise<IDBDatabase> | null = null

  constructor(options: IndexedDbSecureStoreOptions) {
    const profile = options.profile.trim()
    if (!profile) throw new IndexedDbStorageError('profile_mismatch', 'Wallet storage profile is required.')

    const indexedDbFactory = options.indexedDB ?? globalThis.indexedDB
    const cryptoProvider = options.crypto ?? globalThis.crypto
    if (!indexedDbFactory || !cryptoProvider?.subtle || !cryptoProvider.getRandomValues) {
      throw new IndexedDbStorageError(
        'storage_unavailable',
        'Encrypted browser wallet storage is unavailable in this browser.',
      )
    }

    this.profile = profile
    this.databaseName = options.databaseName ?? `nodezero-wallet-${profile}-v1`
    this.indexedDbFactory = indexedDbFactory
    this.cryptoProvider = cryptoProvider
  }

  async getItemAsync(key: string): Promise<string | null> {
    const database = await this.openDatabase()
    const transaction = database.transaction(RECORD_STORE, 'readonly')
    const record = await requestResult(
      transaction.objectStore(RECORD_STORE).get(key) as IDBRequest<EncryptedRecord | undefined>,
    )
    await transactionComplete(transaction)
    if (!record) return null
    if (record.schemaVersion !== 1 || record.profile !== this.profile) {
      throw new IndexedDbStorageError('profile_mismatch', 'Wallet record belongs to another environment profile.')
    }

    try {
      const wrappingKey = await this.getWrappingKey(database)
      const plaintext = await this.cryptoProvider.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: record.iv,
          additionalData: this.additionalData(key),
        },
        wrappingKey,
        record.ciphertext,
      )
      return new TextDecoder().decode(plaintext)
    } catch (error) {
      if (error instanceof IndexedDbStorageError) throw error
      throw new IndexedDbStorageError(
        'storage_corrupt',
        'Encrypted wallet record could not be authenticated.',
        { cause: error },
      )
    }
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    const database = await this.openDatabase()
    const wrappingKey = await this.getWrappingKey(database)
    const iv = this.cryptoProvider.getRandomValues(new Uint8Array(12)).buffer as ArrayBuffer
    const plaintext = new TextEncoder().encode(value).buffer as ArrayBuffer
    const ciphertext = await this.cryptoProvider.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: this.additionalData(key),
      },
      wrappingKey,
      plaintext,
    )
    const transaction = database.transaction(RECORD_STORE, 'readwrite')
    transaction.objectStore(RECORD_STORE).put({
      key,
      schemaVersion: 1,
      profile: this.profile,
      iv,
      ciphertext,
    } satisfies EncryptedRecord)
    await transactionComplete(transaction)
  }

  async deleteItemAsync(key: string): Promise<void> {
    const database = await this.openDatabase()
    const transaction = database.transaction(RECORD_STORE, 'readwrite')
    transaction.objectStore(RECORD_STORE).delete(key)
    await transactionComplete(transaction)
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return
    const database = await this.databasePromise
    database.close()
    this.databasePromise = null
  }

  private additionalData(key: string): ArrayBuffer {
    return new TextEncoder().encode(`${this.profile}|${DATABASE_VERSION}|${key}`).buffer as ArrayBuffer
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.indexedDbFactory.open(this.databaseName, DATABASE_VERSION)
      request.onupgradeneeded = (): void => {
        const database = request.result
        if (!database.objectStoreNames.contains(RECORD_STORE)) {
          database.createObjectStore(RECORD_STORE, { keyPath: 'key' })
        }
        if (!database.objectStoreNames.contains(KEY_STORE)) {
          database.createObjectStore(KEY_STORE, { keyPath: 'id' })
        }
      }
      request.onsuccess = (): void => resolve(request.result)
      request.onerror = (): void => {
        this.databasePromise = null
        reject(
          new IndexedDbStorageError(
            'storage_unavailable',
            'Encrypted browser wallet database could not be opened.',
            { cause: request.error },
          ),
        )
      }
      request.onblocked = (): void => {
        this.databasePromise = null
        reject(new IndexedDbStorageError('storage_unavailable', 'Wallet database upgrade was blocked.'))
      }
    })
    return this.databasePromise
  }

  private async getWrappingKey(database: IDBDatabase): Promise<CryptoKey> {
    const readTransaction = database.transaction(KEY_STORE, 'readonly')
    const existing = await requestResult(
      readTransaction.objectStore(KEY_STORE).get(WRAPPING_KEY_ID) as IDBRequest<StoredWrappingKey | undefined>,
    )
    await transactionComplete(readTransaction)
    if (existing?.key) return existing.key

    const generated = await this.cryptoProvider.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    const writeTransaction = database.transaction(KEY_STORE, 'readwrite')
    const store = writeTransaction.objectStore(KEY_STORE)
    const concurrent = await requestResult(
      store.get(WRAPPING_KEY_ID) as IDBRequest<StoredWrappingKey | undefined>,
    )
    if (concurrent?.key) {
      writeTransaction.abort()
      return concurrent.key
    }
    store.put({ id: WRAPPING_KEY_ID, key: generated } satisfies StoredWrappingKey)
    await transactionComplete(writeTransaction)
    return generated
  }
}