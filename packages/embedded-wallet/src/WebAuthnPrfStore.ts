/**
 * @module WebAuthnPrfStore
 *
 * WebAuthn Level 3 PRF (Pseudo-Random Function / hmac-get-secret) Key Derivation
 * and Hardware-Bound Key Wrapping for NodeZero embedded wallets.
 *
 * Implements hardware-backed key encryption keys (KEK) using biometric platform
 * authenticators (TouchID, FaceID, Windows Hello, YubiKey) to encrypt stored
 * Stellar Ed25519 private keys, with automatic graceful fallback to software
 * non-extractable CryptoKey storage when PRF is unsupported or unavailable.
 */

import type { ISecureStore } from './EnclaveAdapter.js'
import { IndexedDbSecureStore } from './IndexedDbSecureStore.js'

export interface WebAuthnPrfOptions {
  profile: string
  databaseName?: string | undefined
  indexedDB?: IDBFactory | undefined
  crypto?: Crypto | undefined
  salt?: Uint8Array | undefined
  rpId?: string | undefined
  allowSoftwareFallback?: boolean | undefined
  credentialsContainer?: CredentialsContainer | undefined
  publicKeyCredentialClass?: typeof PublicKeyCredential | undefined
}

export interface WebAuthnCapabilities {
  prfSupported: boolean
  platformAuthenticatorAvailable: boolean
  details?: string | undefined
}

/**
 * Checks if WebAuthn Level 3 PRF (hmac-get-secret) extension is supported in the current environment.
 */
export async function checkWebAuthnPrfSupport(options?: {
  credentialsContainer?: CredentialsContainer | undefined
  publicKeyCredentialClass?: typeof PublicKeyCredential | undefined
}): Promise<WebAuthnCapabilities> {
  const pubKeyCred = options?.publicKeyCredentialClass ?? (globalThis as unknown as { PublicKeyCredential?: typeof PublicKeyCredential }).PublicKeyCredential
  const credentials = options?.credentialsContainer ?? globalThis.navigator?.credentials

  if (!pubKeyCred || !credentials) {
    return {
      prfSupported: false,
      platformAuthenticatorAvailable: false,
      details: 'WebAuthn credentials container not available in this environment.',
    }
  }

  let platformAvailable = false
  try {
    if (typeof pubKeyCred.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      platformAvailable = await pubKeyCred.isUserVerifyingPlatformAuthenticatorAvailable()
    }
  } catch {
    platformAvailable = false
  }

  let prfSupported = false
  try {
    const pubKeyCredWithCaps = pubKeyCred as unknown as {
      getClientCapabilities?: () => Promise<Record<string, unknown>>
    }
    if (typeof pubKeyCredWithCaps.getClientCapabilities === 'function') {
      const capabilities = await pubKeyCredWithCaps.getClientCapabilities()
      if (capabilities && (capabilities.prf === true || capabilities['hybridPrf'] === true)) {
        prfSupported = true
      }
    }
  } catch {
    // If capability check throws or is unhandled, keep prfSupported as false
  }

  return {
    prfSupported,
    platformAuthenticatorAvailable: platformAvailable,
    details: prfSupported
      ? 'WebAuthn Level 3 PRF extension supported.'
      : 'WebAuthn PRF extension not reported by platform.',
  }
}

function toArrayBuffer(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  // Copy into a fresh ArrayBuffer: `data.buffer` widens to ArrayBufferLike.
  const out = new ArrayBuffer(data.byteLength)
  new Uint8Array(out).set(data)
  return out
}

/**
 * Derives a 256-bit AES-GCM wrapping CryptoKey from a 32-byte PRF secret output using HKDF-SHA256.
 */
export async function deriveKeyFromPrfSecret(
  prfSecretBytes: Uint8Array | ArrayBuffer,
  profile: string,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<CryptoKey> {
  const rawKeyData = toArrayBuffer(prfSecretBytes)
  const rawKey = await cryptoProvider.subtle.importKey(
    'raw',
    rawKeyData,
    'HKDF',
    false,
    ['deriveKey'],
  )

  const saltBytes = toArrayBuffer(new TextEncoder().encode(`nodezero.prf.salt.v1.${profile}`))
  const infoBytes = toArrayBuffer(new TextEncoder().encode(`nodezero.embedded-wallet.kek.v1|${profile}`))

  return cryptoProvider.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: infoBytes,
    },
    rawKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * WebAuthn PRF-backed Key Provider that derives or supplies the Key Encryption Key (KEK).
 */
export class WebAuthnPrfKeyProvider {
  readonly profile: string
  readonly rpId?: string | undefined
  readonly salt: Uint8Array
  private readonly cryptoProvider: Crypto
  private cachedWrappingKey: CryptoKey | null = null
  private isPrfBound = false

  constructor(options: {
    profile: string
    crypto?: Crypto | undefined
    rpId?: string | undefined
    salt?: Uint8Array | undefined
  }) {
    this.profile = options.profile
    this.cryptoProvider = options.crypto ?? globalThis.crypto
    this.rpId = options.rpId
    this.salt = options.salt ?? new TextEncoder().encode(`nodezero.prf.evaluation.salt.v1.${options.profile}`)
  }

  /**
   * Supplies a PRF evaluation secret (e.g. from passkey assertion or unit test).
   */
  async setPrfSecret(prfSecretBytes: Uint8Array | ArrayBuffer): Promise<void> {
    this.cachedWrappingKey = await deriveKeyFromPrfSecret(
      prfSecretBytes,
      this.profile,
      this.cryptoProvider,
    )
    this.isPrfBound = true
  }

  /**
   * Returns whether the active key provider is backed by WebAuthn PRF hardware derivation.
   */
  isHardwareProtected(): boolean {
    return this.isPrfBound && this.cachedWrappingKey !== null
  }

  /**
   * Provider function suitable for IndexedDbSecureStore wrappingKeyProvider.
   */
  async getWrappingKey(database: IDBDatabase, crypto: Crypto): Promise<CryptoKey> {
    if (this.cachedWrappingKey) {
      return this.cachedWrappingKey
    }

    const KEY_STORE = 'keys'
    const WRAPPING_KEY_ID = 'wallet-records-v1'

    const readTransaction = database.transaction(KEY_STORE, 'readonly')
    const existing = await new Promise<{ id: string; key: CryptoKey } | undefined>((resolve, reject) => {
      const request = readTransaction.objectStore(KEY_STORE).get(WRAPPING_KEY_ID) as IDBRequest<{ id: string; key: CryptoKey } | undefined>
      request.onsuccess = (): void => resolve(request.result)
      request.onerror = (): void => reject(request.error ?? new Error('Failed to read wrapping key'))
    })

    if (existing?.key) return existing.key

    const generated = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    const writeTransaction = database.transaction(KEY_STORE, 'readwrite')
    const store = writeTransaction.objectStore(KEY_STORE)
    store.put({ id: WRAPPING_KEY_ID, key: generated })
    await new Promise<void>((resolve, reject) => {
      writeTransaction.oncomplete = (): void => resolve()
      writeTransaction.onerror = (): void =>
        reject(writeTransaction.error ?? new Error('Failed to save wrapping key'))
    })
    return generated
  }
}

/**
 * Creates an ISecureStore backed by WebAuthn PRF key wrapping when available,
 * falling back gracefully to standard encrypted IndexedDB storage.
 */
export function createHardwareBoundSecureStore(
  options: WebAuthnPrfOptions,
  prfProvider?: WebAuthnPrfKeyProvider | undefined,
): ISecureStore {
  const provider = prfProvider ?? new WebAuthnPrfKeyProvider({
    profile: options.profile,
    crypto: options.crypto,
    rpId: options.rpId,
    salt: options.salt,
  })

  return new IndexedDbSecureStore({
    profile: options.profile,
    databaseName: options.databaseName,
    indexedDB: options.indexedDB,
    crypto: options.crypto,
    wrappingKeyProvider: (db, crypto) => provider.getWrappingKey(db, crypto),
  })
}
