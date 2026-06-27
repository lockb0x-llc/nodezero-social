/**
 * @module EnclaveAdapter
 *
 * Platform-agnostic adapter for storing the Stellar secret key in a device
 * secure enclave.
 *
 * On React Native / Expo the adapter wraps `expo-secure-store` (iOS Secure
 * Enclave or Android Keystore).  In Node.js environments (e.g. tests, server-
 * side tooling) it falls back to an in-memory store – **never use the
 * in-memory fallback in production**.
 */

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

const STELLAR_SECRET_KEY = 'nodezero.stellar.secret'

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

  /**
   * Loads the stored Stellar secret key, or generates a new Ed25519 keypair
   * and stores it if none exists yet.
   *
   * Returns the secret key in the Stellar format (S… base-32 string).
   */
  async loadOrCreate(): Promise<string> {
    const existing = await this.store.getItemAsync(STELLAR_SECRET_KEY)
    if (existing) return existing

    // Generate new keypair – import stellar-sdk lazily to keep the bundle lean
    // when the caller only needs the store utilities.
    const { Keypair } = await import('@stellar/stellar-sdk')
    const keypair = Keypair.random()
    const secret = keypair.secret()

    await this.store.setItemAsync(STELLAR_SECRET_KEY, secret)
    return secret
  }

  /**
   * Returns the stored secret key, or `null` if no key has been provisioned.
   */
  async load(): Promise<string | null> {
    return this.store.getItemAsync(STELLAR_SECRET_KEY)
  }

  /**
   * Permanently removes the secret key from the enclave.
   * This is irreversible – the wallet cannot be recovered afterwards.
   */
  async destroy(): Promise<void> {
    await this.store.deleteItemAsync(STELLAR_SECRET_KEY)
  }
}
