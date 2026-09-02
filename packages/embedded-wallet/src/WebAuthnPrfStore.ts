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

/** Thrown when a hardware-bound store is requested but PRF is not usable. */
export class PrfUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrfUnavailableError'
  }
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Identifies the passkey that holds the wallet's PRF secret. */
export interface PrfPasskeyRecord {
  credentialId: string
  createdAt: string
}

interface PrfExtensionResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
}

interface CeremonyOptions {
  profile: string
  credentialsContainer?: CredentialsContainer | undefined
  crypto?: Crypto | undefined
  rpId?: string | undefined
  userName?: string | undefined
  userDisplayName?: string | undefined
  timeoutMs?: number | undefined
}

function requireCredentials(options: CeremonyOptions): CredentialsContainer {
  const credentials = options.credentialsContainer ?? globalThis.navigator?.credentials
  if (!credentials?.create || !credentials.get) {
    throw new PrfUnavailableError('WebAuthn is not available in this environment.')
  }
  return credentials
}

/**
 * Registers a platform passkey with the PRF extension enabled.
 *
 * Returns the credential id, which the caller must persist: PRF evaluation on
 * subsequent unlocks requires naming this exact credential.
 *
 * @throws PrfUnavailableError when the authenticator does not report PRF support.
 */
export async function registerPrfPasskey(
  options: CeremonyOptions & { userId?: Uint8Array | undefined }
): Promise<PrfPasskeyRecord> {
  const credentials = requireCredentials(options)
  const cryptoProvider = options.crypto ?? globalThis.crypto
  const challenge = cryptoProvider.getRandomValues(new Uint8Array(32))
  const userId = options.userId ?? cryptoProvider.getRandomValues(new Uint8Array(32))

  const created = (await credentials.create({
    publicKey: {
      challenge: toArrayBuffer(challenge),
      rp: { name: 'NodeZero', ...(options.rpId ? { id: options.rpId } : {}) },
      user: {
        id: toArrayBuffer(userId),
        name: options.userName ?? `nodezero-${options.profile}`,
        displayName: options.userDisplayName ?? 'NodeZero Wallet',
      },
      // ES256 then RS256; the wallet never uses this key to sign, it only carries PRF.
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      timeout: options.timeoutMs ?? 120_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null

  if (!created) {
    throw new PrfUnavailableError('Passkey registration was cancelled.')
  }

  const results = created.getClientExtensionResults() as PrfExtensionResults
  if (results.prf?.enabled !== true) {
    throw new PrfUnavailableError(
      'This authenticator registered a passkey but does not support the PRF extension.'
    )
  }

  return {
    credentialId: base64UrlEncode(new Uint8Array(created.rawId)),
    createdAt: new Date().toISOString(),
  }
}

/**
 * Evaluates the PRF for a registered passkey, returning the raw secret.
 *
 * Requires a user-verification gesture (biometric or PIN), which is the property that
 * makes this meaningfully stronger than an origin-bound software key: a silent script
 * cannot obtain the secret without user presence.
 */
export async function assertPrfSecret(
  options: CeremonyOptions & { credentialId: string; salt: Uint8Array }
): Promise<Uint8Array> {
  const credentials = requireCredentials(options)
  const cryptoProvider = options.crypto ?? globalThis.crypto
  const challenge = cryptoProvider.getRandomValues(new Uint8Array(32))

  const assertion = (await credentials.get({
    publicKey: {
      challenge: toArrayBuffer(challenge),
      ...(options.rpId ? { rpId: options.rpId } : {}),
      allowCredentials: [
        {
          type: 'public-key',
          id: toArrayBuffer(base64UrlDecode(options.credentialId)),
        },
      ],
      userVerification: 'required',
      timeout: options.timeoutMs ?? 120_000,
      extensions: {
        prf: { eval: { first: toArrayBuffer(options.salt) } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null

  if (!assertion) {
    throw new PrfUnavailableError('Passkey verification was cancelled.')
  }

  const results = assertion.getClientExtensionResults() as PrfExtensionResults
  const first = results.prf?.results?.first
  if (!first) {
    throw new PrfUnavailableError('Authenticator did not return a PRF evaluation result.')
  }
  return new Uint8Array(first)
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
  private readonly allowSoftwareFallback: boolean
  private cachedWrappingKey: CryptoKey | null = null
  private isPrfBound = false

  constructor(options: {
    profile: string
    crypto?: Crypto | undefined
    rpId?: string | undefined
    salt?: Uint8Array | undefined
    /** Opt-in only. Without PRF the store is not hardware-bound. */
    allowSoftwareFallback?: boolean | undefined
  }) {
    this.profile = options.profile
    this.cryptoProvider = options.crypto ?? globalThis.crypto
    this.rpId = options.rpId
    this.allowSoftwareFallback = options.allowSoftwareFallback ?? false
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

    // Fail closed: silently generating a software key here would report success while
    // providing no hardware binding at all. Software fallback must be explicit.
    if (!this.allowSoftwareFallback) {
      throw new PrfUnavailableError(
        'Wallet storage is not unlocked. Complete passkey verification before accessing wallet records.'
      )
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
 * Creates an ISecureStore whose wrapping key is derived from a WebAuthn PRF secret.
 *
 * The store fails closed until {@link WebAuthnPrfKeyProvider.setPrfSecret} has been called
 * with a passkey assertion result, unless `allowSoftwareFallback` is explicitly enabled.
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
    allowSoftwareFallback: options.allowSoftwareFallback,
  })

  return new IndexedDbSecureStore({
    profile: options.profile,
    databaseName: options.databaseName,
    indexedDB: options.indexedDB,
    crypto: options.crypto,
    wrappingKeyProvider: (db, crypto) => provider.getWrappingKey(db, crypto),
  })
}

/**
 * Unlocks a PRF provider by running the passkey assertion and binding the derived key.
 *
 * Registers a new passkey when no record is supplied, returning the record so the caller
 * can persist it for subsequent unlocks.
 */
export async function unlockPrfProvider(
  provider: WebAuthnPrfKeyProvider,
  options: CeremonyOptions & { record?: PrfPasskeyRecord | undefined }
): Promise<PrfPasskeyRecord> {
  const record =
    options.record ??
    (await registerPrfPasskey({
      profile: options.profile,
      credentialsContainer: options.credentialsContainer,
      crypto: options.crypto,
      rpId: options.rpId ?? provider.rpId,
      userName: options.userName,
      userDisplayName: options.userDisplayName,
      timeoutMs: options.timeoutMs,
    }))

  const secret = await assertPrfSecret({
    profile: options.profile,
    credentialsContainer: options.credentialsContainer,
    crypto: options.crypto,
    rpId: options.rpId ?? provider.rpId,
    timeoutMs: options.timeoutMs,
    credentialId: record.credentialId,
    salt: provider.salt,
  })

  await provider.setPrfSecret(secret)
  return record
}
