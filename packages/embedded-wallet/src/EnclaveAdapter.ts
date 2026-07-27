/**
 * @module EnclaveAdapter
 *
 * Platform-agnostic adapter for storing Stellar Ed25519 secrets in a device
 * secure enclave.
 *
 * On React Native / Expo the adapter wraps `expo-secure-store` (iOS Secure
 * Enclave or Android Keystore). In browser environments it uses localStorage.
 * In Node.js environments (e.g. tests, server-side tooling) it falls back to
 * an in-memory store – **never use the in-memory fallback in production**.
 */



interface KeyringIndexRecord {
  version: 1
  keyIds: string[]
}

interface StoredIdentityMeta {
  keyId: string
  label: string
  createdAt: string
  lastUsedAt: string | null
}

export interface EnclaveIdentityRecord {
  keyId: string
  label: string
  createdAt: string
  lastUsedAt: string | null
}

export class MissingIdentitySecretError extends Error {
  readonly keyId: string

  constructor(keyId: string) {
    super('This identity exists in the wallet index, but its secret key is missing. Import its recovery bundle to continue.')
    this.name = 'MissingIdentitySecretError'
    this.keyId = keyId
  }
}

/** Interface that every enclave implementation must satisfy. */
export interface ISecureStore {
  /** Retrieves the secret for a given key. */
  getItemAsync(key: string): Promise<string | null>
  /** Persists the secret under the given key. */
  setItemAsync(key: string, value: string): Promise<void>
  /** Removes the secret for the given key. */
  deleteItemAsync(key: string): Promise<void>
}

/** In-memory fallback store used in test / Node.js environments. */
class MemorySecureStore implements ISecureStore {
  private store: Map<string, string> = new Map()

  getItemAsync(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null)
  }
  setItemAsync(key: string, value: string): Promise<void> {
    this.store.set(key, value)
    return Promise.resolve()
  }
  deleteItemAsync(key: string): Promise<void> {
    this.store.delete(key)
    return Promise.resolve()
  }
}

interface BrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function getBrowserLocalStorage(): BrowserStorage | undefined {
  const candidate = (globalThis as { localStorage?: BrowserStorage }).localStorage
  return candidate
}

class WebLocalStorageSecureStore implements ISecureStore {
  private readonly prefix = 'nodezero.embedded-wallet.'

  getItemAsync(key: string): Promise<string | null> {
    return Promise.resolve(getBrowserLocalStorage()?.getItem(`${this.prefix}${key}`) ?? null)
  }

  setItemAsync(key: string, value: string): Promise<void> {
    getBrowserLocalStorage()?.setItem(`${this.prefix}${key}`, value)
    return Promise.resolve()
  }

  deleteItemAsync(key: string): Promise<void> {
    getBrowserLocalStorage()?.removeItem(`${this.prefix}${key}`)
    return Promise.resolve()
  }
}

const LEGACY_STELLAR_SECRET_KEY = 'nodezero.stellar.secret'
const KEYRING_INDEX_KEY = 'nodezero.stellar.keyring.index.v1'
const ACTIVE_KEY_ID_KEY = 'nodezero.stellar.active-key-id.v1'
const IDENTITY_META_PREFIX = 'nodezero.stellar.identity.meta.'
const STELLAR_SECRET_PREFIX = 'nodezero.stellar.secret.'

function toSecretKey(keyId: string): string {
  return `${STELLAR_SECRET_PREFIX}${keyId}`
}

function toIdentityMetaKey(keyId: string): string {
  return `${IDENTITY_META_PREFIX}${keyId}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Manages secure storage and retrieval of the Stellar Ed25519 secret key.
 *
 * @example
 * ```ts
 * import * as ExpoSecureStore from 'expo-secure-store'
 * const adapter = new EnclaveAdapter(ExpoSecureStore)
 * const secret = await adapter.loadOrCreate()
 * ```
 */
export class EnclaveAdapter {
  private readonly store: ISecureStore

  /**
   * @param store - A concrete `ISecureStore` implementation.
   *   Pass `expo-secure-store` on device; omit for the in-memory fallback.
   */
  constructor(store?: ISecureStore) {
    if (store) {
      this.store = store
    } else if (getBrowserLocalStorage()) {
      this.store = new WebLocalStorageSecureStore()
    } else {
      console.warn(
        '[EnclaveAdapter] No secure store provided – falling back to in-memory store. ' +
          'This is NOT secure and must not be used in production.'
      )
      this.store = new MemorySecureStore()
    }
  }

  private async loadJson<T>(key: string): Promise<T | null> {
    const raw = await this.store.getItemAsync(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  private async saveJson(key: string, value: unknown): Promise<void> {
    await this.store.setItemAsync(key, JSON.stringify(value))
  }

  private async loadKeyringIndex(): Promise<KeyringIndexRecord> {
    const parsed = await this.loadJson<KeyringIndexRecord>(KEYRING_INDEX_KEY)
    if (parsed && parsed.version === 1 && Array.isArray(parsed.keyIds)) {
      return { version: 1, keyIds: Array.from(new Set(parsed.keyIds.filter((id) => typeof id === 'string' && id.trim()))) }
    }
    return { version: 1, keyIds: [] }
  }

  private async saveKeyringIndex(index: KeyringIndexRecord): Promise<void> {
    await this.saveJson(KEYRING_INDEX_KEY, {
      version: 1,
      keyIds: Array.from(new Set(index.keyIds.filter((id) => id.trim()))),
    })
  }

  private async loadIdentityMeta(keyId: string): Promise<StoredIdentityMeta | null> {
    const parsed = await this.loadJson<StoredIdentityMeta>(toIdentityMetaKey(keyId))
    if (!parsed || parsed.keyId !== keyId) return null
    if (typeof parsed.label !== 'string' || !parsed.label.trim()) return null
    if (typeof parsed.createdAt !== 'string' || !parsed.createdAt) return null
    if (!(typeof parsed.lastUsedAt === 'string' || parsed.lastUsedAt === null)) return null
    return parsed
  }

  private async saveIdentityMeta(meta: StoredIdentityMeta): Promise<void> {
    await this.saveJson(toIdentityMetaKey(meta.keyId), meta)
  }

  private async ensureActiveKeyId(index: KeyringIndexRecord): Promise<string | null> {
    const current = await this.store.getItemAsync(ACTIVE_KEY_ID_KEY)
    if (current && index.keyIds.includes(current)) return current

    const fallback = index.keyIds[0] ?? null
    if (fallback) {
      await this.store.setItemAsync(ACTIVE_KEY_ID_KEY, fallback)
    } else {
      await this.store.deleteItemAsync(ACTIVE_KEY_ID_KEY)
    }
    return fallback
  }

  private async migrateLegacySingleSecretIfPresent(index: KeyringIndexRecord): Promise<KeyringIndexRecord> {
    if (index.keyIds.length > 0) return index

    const legacySecret = await this.store.getItemAsync(LEGACY_STELLAR_SECRET_KEY)
    if (!legacySecret) return index

    const hex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0') + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
    const keyId = `id-${hex}`
    const createdAt = nowIso()
    await this.store.setItemAsync(toSecretKey(keyId), legacySecret)
    await this.saveIdentityMeta({
      keyId,
      label: 'Identity 1',
      createdAt,
      lastUsedAt: null,
    })

    const migrated: KeyringIndexRecord = { version: 1, keyIds: [keyId] }
    await this.saveKeyringIndex(migrated)
    await this.store.setItemAsync(ACTIVE_KEY_ID_KEY, keyId)
    await this.store.deleteItemAsync(LEGACY_STELLAR_SECRET_KEY)
    return migrated
  }

  private async ensureKeyring(): Promise<KeyringIndexRecord> {
    const loaded = await this.loadKeyringIndex()
    const migrated = await this.migrateLegacySingleSecretIfPresent(loaded)
    await this.ensureActiveKeyId(migrated)
    return migrated
  }

  private async resolveKeyId(inputKeyId?: string): Promise<string | null> {
    const index = await this.ensureKeyring()
    if (inputKeyId) {
      return index.keyIds.includes(inputKeyId) ? inputKeyId : null
    }
    return this.ensureActiveKeyId(index)
  }

  async listIdentityKeyIds(): Promise<string[]> {
    const index = await this.ensureKeyring()
    return [...index.keyIds]
  }

  async listIdentities(): Promise<EnclaveIdentityRecord[]> {
    const keyIds = await this.listIdentityKeyIds()
    const identities = await Promise.all(
      keyIds.map(async (keyId) => {
        const meta = await this.loadIdentityMeta(keyId)
        if (!meta) return null
        return {
          keyId: meta.keyId,
          label: meta.label,
          createdAt: meta.createdAt,
          lastUsedAt: meta.lastUsedAt,
        } satisfies EnclaveIdentityRecord
      }),
    )
    return identities.filter((item): item is EnclaveIdentityRecord => item !== null)
  }

  async getActiveIdentityKeyId(): Promise<string | null> {
    const index = await this.ensureKeyring()
    return this.ensureActiveKeyId(index)
  }

  async setActiveIdentityKeyId(keyId: string): Promise<void> {
    const index = await this.ensureKeyring()
    if (!index.keyIds.includes(keyId)) {
      throw new Error('Identity keyId does not exist in keyring.')
    }
    await this.store.setItemAsync(ACTIVE_KEY_ID_KEY, keyId)
  }

  async createIdentity(label?: string): Promise<EnclaveIdentityRecord> {
    const index = await this.ensureKeyring()
    const hex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0') + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
    const keyId = `id-${hex}`
    const createdAt = nowIso()
    const identityLabel = label?.trim() ? label.trim() : `Identity ${index.keyIds.length + 1}`

    // Generate a fresh keypair for the new identity.
    const { Keypair } = await import('@stellar/stellar-sdk')
    const secret = Keypair.random().secret()
    await this.store.setItemAsync(toSecretKey(keyId), secret)

    const meta: StoredIdentityMeta = {
      keyId,
      label: identityLabel,
      createdAt,
      lastUsedAt: null,
    }
    await this.saveIdentityMeta(meta)

    const nextIndex: KeyringIndexRecord = {
      version: 1,
      keyIds: [...index.keyIds, keyId],
    }
    await this.saveKeyringIndex(nextIndex)
    await this.store.setItemAsync(ACTIVE_KEY_ID_KEY, keyId)

    return {
      keyId,
      label: identityLabel,
      createdAt,
      lastUsedAt: null,
    }
  }

  async renameIdentity(keyId: string, label: string): Promise<void> {
    const trimmed = label.trim()
    if (!trimmed) {
      throw new Error('Identity label is required.')
    }
    const meta = await this.loadIdentityMeta(keyId)
    if (!meta) {
      throw new Error('Identity keyId does not exist in keyring.')
    }
    await this.saveIdentityMeta({ ...meta, label: trimmed })
  }

  async deleteIdentity(keyId: string): Promise<void> {
    const index = await this.ensureKeyring()
    if (!index.keyIds.includes(keyId)) {
      throw new Error('Identity keyId does not exist in keyring.')
    }

    await this.store.deleteItemAsync(toSecretKey(keyId))
    await this.store.deleteItemAsync(toIdentityMetaKey(keyId))

    const nextIndex: KeyringIndexRecord = {
      version: 1,
      keyIds: index.keyIds.filter((id) => id !== keyId),
    }
    await this.saveKeyringIndex(nextIndex)

    const active = await this.store.getItemAsync(ACTIVE_KEY_ID_KEY)
    if (active === keyId) {
      const fallback = nextIndex.keyIds[0] ?? null
      if (fallback) {
        await this.store.setItemAsync(ACTIVE_KEY_ID_KEY, fallback)
      } else {
        await this.store.deleteItemAsync(ACTIVE_KEY_ID_KEY)
      }
    }
  }

  async hasAnyIdentity(): Promise<boolean> {
    const ids = await this.listIdentityKeyIds()
    return ids.length > 0
  }

  /**
   * Loads the stored Stellar secret key, or generates a new Ed25519 keypair
   * and stores it if none exists yet.
   *
   * Returns the secret key in the Stellar format (S… base-32 string).
   */
  async loadOrCreate(keyId?: string): Promise<string> {
    let resolvedKeyId = await this.resolveKeyId(keyId)
    if (!resolvedKeyId) {
      const created = await this.createIdentity()
      resolvedKeyId = created.keyId
    }

    const existing = await this.store.getItemAsync(toSecretKey(resolvedKeyId))
    if (existing) {
      const meta = await this.loadIdentityMeta(resolvedKeyId)
      if (meta) {
        await this.saveIdentityMeta({
          ...meta,
          lastUsedAt: nowIso(),
        })
      }
      await this.store.setItemAsync(ACTIVE_KEY_ID_KEY, resolvedKeyId)
      return existing
    }

    throw new MissingIdentitySecretError(resolvedKeyId)
  }

  /**
   * Returns the stored secret key, or `null` if no key has been provisioned.
   */
  async load(keyId?: string): Promise<string | null> {
    const resolvedKeyId = await this.resolveKeyId(keyId)
    if (!resolvedKeyId) return null
    return this.store.getItemAsync(toSecretKey(resolvedKeyId))
  }

  /**
   * Permanently removes the secret key from the enclave.
   * This is irreversible – the wallet cannot be recovered afterwards.
   */
  async destroy(keyId?: string): Promise<void> {
    const resolvedKeyId = await this.resolveKeyId(keyId)
    if (!resolvedKeyId) return
    await this.deleteIdentity(resolvedKeyId)
  }
}
