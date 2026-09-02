/**
 * Password-based encryption for the identity recovery bundle.
 *
 * The bundle carries the raw Stellar secret key, so it is the single most sensitive
 * artifact a user can export. It is encrypted with AES-256-GCM under a key derived from
 * the user's passphrase via PBKDF2-SHA256.
 *
 * Legacy ZIP encryption (ZipCrypto) is deliberately not used: it is broken by a
 * known-plaintext attack, and this payload begins with a fixed JSON preamble, which is
 * precisely the condition that attack needs.
 */

const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12
const KEY_BITS = 256

export const RECOVERY_KDF = 'PBKDF2-SHA256'
export const RECOVERY_CIPHER = 'AES-256-GCM'

export interface EncryptedRecoveryPayload {
  kdf: typeof RECOVERY_KDF
  iterations: number
  saltB64: string
  cipher: typeof RECOVERY_CIPHER
  ivB64: string
  ciphertextB64: string
}

function getCrypto(): Crypto {
  const candidate = (globalThis as { crypto?: Crypto }).crypto
  if (!candidate?.subtle) {
    throw new Error('Secure crypto is unavailable in this environment.')
  }
  return candidate
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const subtle = getCrypto().subtle
  const material = await subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  )
}

/** Minimum passphrase length. Short passphrases make the KDF cost irrelevant. */
export const MIN_RECOVERY_PASSPHRASE_LENGTH = 12

export function assertUsablePassphrase(passphrase: string): void {
  if (passphrase.length < MIN_RECOVERY_PASSPHRASE_LENGTH) {
    throw new Error(
      `Recovery password must be at least ${MIN_RECOVERY_PASSPHRASE_LENGTH} characters.`
    )
  }
}

export async function encryptRecoveryPayload(
  plaintext: string,
  passphrase: string
): Promise<EncryptedRecoveryPayload> {
  assertUsablePassphrase(passphrase)
  const crypto = getCrypto()
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(new TextEncoder().encode(plaintext))
  )

  return {
    kdf: RECOVERY_KDF,
    iterations: PBKDF2_ITERATIONS,
    saltB64: toBase64(salt),
    cipher: RECOVERY_CIPHER,
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(new Uint8Array(ciphertext)),
  }
}

export async function decryptRecoveryPayload(
  payload: EncryptedRecoveryPayload,
  passphrase: string
): Promise<string> {
  if (payload.kdf !== RECOVERY_KDF || payload.cipher !== RECOVERY_CIPHER) {
    throw new Error('Recovery bundle uses an unsupported encryption scheme.')
  }
  if (!Number.isInteger(payload.iterations) || payload.iterations < 100_000) {
    throw new Error('Recovery bundle key-derivation cost is too low to trust.')
  }

  const key = await deriveKey(passphrase, fromBase64(payload.saltB64), payload.iterations)
  try {
    const plaintext = await getCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(fromBase64(payload.ivB64)) },
      key,
      toArrayBuffer(fromBase64(payload.ciphertextB64))
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    // GCM authentication failure is indistinguishable from a wrong password by design.
    throw new Error('Recovery password is incorrect, or the bundle has been modified.')
  }
}
