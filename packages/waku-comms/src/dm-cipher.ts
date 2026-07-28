/**
 * @module dm-cipher
 * End-to-end encryption for DM bodies: ECIES over WebCrypto P-256 ECDH with
 * HKDF-SHA256 key derivation and AES-256-GCM sealing.
 *
 * Key model (session keys, distributed in-band):
 * - Each client generates an ephemeral *session* DM key pair at transport
 *   start. The public JWK travels inside presence beacons and mutual-reveal
 *   payloads; the private key never leaves memory.
 * - Every message is sealed under a fresh sender-side ephemeral key pair
 *   (ECIES), so a leaked session key never exposes sender keys.
 *
 * Only WebCrypto (`crypto.subtle`) is used so this runs unchanged in the
 * Expo web bundle and in Node (tests / QA harnesses). A future hardening may
 * replace session keys with X25519 keys derived from the device Stellar key
 * (static, Pod-profile-published); the wire format is versioned for that.
 */

const WIRE_VERSION = 1
const WIRE_ALG = 'ECIES-P256-AESGCM'
const HKDF_INFO = 'NZ_DM_CIPHER_V1'
const HKDF_SALT = 'NZ_DM_SALT_V1'
const GCM_IV_BYTES = 12
const EC_PARAMS: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' }

/** Public half of a DM session key, safe to publish in beacons/reveals. */
export interface DmPublicJwk {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
}

/** A DM session key pair. The private key must never be serialized. */
export interface DmKeyPair {
  publicJwk: DmPublicJwk
  privateKey: CryptoKey
}

/** Sealed DM body wire format (JSON-serialized into the envelope body). */
export interface DmCiphertext {
  v: number
  alg: string
  /** Sender-side ephemeral public key. */
  epk: DmPublicJwk
  /** Base64 AES-GCM IV. */
  iv: string
  /** Base64 ciphertext + GCM tag. */
  ct: string
}

/** Shape-check a value as a DM public JWK. */
export function isDmPublicJwk(value: unknown): value is DmPublicJwk {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.kty === 'EC' &&
    candidate.crv === 'P-256' &&
    typeof candidate.x === 'string' &&
    candidate.x.length > 0 &&
    typeof candidate.y === 'string' &&
    candidate.y.length > 0
  )
}

/** Generate a fresh DM session key pair. */
export async function generateDmKeyPair(): Promise<DmKeyPair> {
  const pair = await crypto.subtle.generateKey(EC_PARAMS, false, ['deriveBits'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  if (!isDmPublicJwk(jwk)) {
    throw new Error('Generated DM public key has an unexpected JWK shape')
  }
  return { publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, privateKey: pair.privateKey }
}

async function importPublicKey(jwk: DmPublicJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    EC_PARAMS,
    true,
    [],
  )
}

async function deriveAesKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(HKDF_SALT), info: enc.encode(HKDF_INFO) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Seal a plaintext for the holder of `recipientPublicJwk`. */
export async function encryptDmBody(
  recipientPublicJwk: DmPublicJwk,
  plaintext: string,
): Promise<DmCiphertext> {
  const recipientKey = await importPublicKey(recipientPublicJwk)
  const ephemeral = await crypto.subtle.generateKey(EC_PARAMS, true, ['deriveBits'])
  const aesKey = await deriveAesKey(ephemeral.privateKey, recipientKey)
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plaintext)),
  )
  const epkJwk = await crypto.subtle.exportKey('jwk', ephemeral.publicKey)
  if (!isDmPublicJwk(epkJwk)) {
    throw new Error('Ephemeral DM public key has an unexpected JWK shape')
  }
  return {
    v: WIRE_VERSION,
    alg: WIRE_ALG,
    epk: { kty: 'EC', crv: 'P-256', x: epkJwk.x, y: epkJwk.y },
    iv: bytesToBase64(iv),
    ct: bytesToBase64(sealed),
  }
}

/**
 * Open a sealed DM body with the recipient's session private key.
 * Throws on tamper (GCM auth failure) or wrong key.
 */
export async function decryptDmBody(privateKey: CryptoKey, sealed: DmCiphertext): Promise<string> {
  if (sealed.v !== WIRE_VERSION || sealed.alg !== WIRE_ALG) {
    throw new Error(`Unsupported DM ciphertext format: v${sealed.v} ${sealed.alg}`)
  }
  const ephemeralKey = await importPublicKey(sealed.epk)
  const aesKey = await deriveAesKey(privateKey, ephemeralKey)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToArrayBuffer(sealed.iv) },
    aesKey,
    base64ToArrayBuffer(sealed.ct),
  )
  return new TextDecoder().decode(plaintext)
}

/** Shape-check a parsed value as a {@link DmCiphertext}. */
export function isDmCiphertext(value: unknown): value is DmCiphertext {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.v === 'number' &&
    typeof candidate.alg === 'string' &&
    isDmPublicJwk(candidate.epk) &&
    typeof candidate.iv === 'string' &&
    typeof candidate.ct === 'string'
  )
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64')
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  if (typeof atob === 'function') {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }
  const buffer = Buffer.from(base64, 'base64')
  const bytes = new Uint8Array(buffer.length)
  bytes.set(buffer)
  return bytes.buffer
}
