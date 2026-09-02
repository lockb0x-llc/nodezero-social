import {
  decryptRecoveryPayload,
  encryptRecoveryPayload,
  type EncryptedRecoveryPayload,
} from './recoveryBundleCrypto'

export interface RecoveryIdentityInput {
  secret: string
  expectedPublicKey: string
  label: string
}

/**
 * Recovery bundle v2.
 *
 * Environment binding stays in cleartext so a bundle can be rejected for the wrong
 * profile or network before a password is requested. Everything that identifies or
 * authenticates the user — WebID and wallet keys — lives inside `encrypted`.
 */
interface RecoveryBundlePayload {
  bundleVersion?: unknown
  envProfile?: unknown
  stellarNetworkPassphrase?: unknown
  encrypted?: unknown
}

interface DecryptedRecoveryPayload {
  webId?: unknown
  wallet?: {
    publicKey?: unknown
    secretKey?: unknown
  }
}

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/
const STELLAR_SECRET_KEY = /^S[A-Z2-7]{55}$/

export const RECOVERY_BUNDLE_VERSION = 2

function isEncryptedPayload(value: unknown): value is EncryptedRecoveryPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.kdf === 'string' &&
    typeof candidate.cipher === 'string' &&
    typeof candidate.saltB64 === 'string' &&
    typeof candidate.ivB64 === 'string' &&
    typeof candidate.ciphertextB64 === 'string' &&
    typeof candidate.iterations === 'number'
  )
}

/** Builds the encrypted portion of a recovery bundle. */
export async function sealRecoveryBundle(
  input: { webId: string | null; publicKey: string; secretKey: string },
  passphrase: string
): Promise<EncryptedRecoveryPayload> {
  return encryptRecoveryPayload(
    JSON.stringify({
      webId: input.webId,
      wallet: { publicKey: input.publicKey, secretKey: input.secretKey },
    }),
    passphrase
  )
}

/**
 * Validates and decrypts a recovery bundle.
 *
 * Profile and network are checked before decryption so a bundle from the wrong lane
 * fails fast without the user supplying a password.
 */
export async function parseRecoveryBundle(
  json: string,
  expectedProfile: string,
  expectedNetworkPassphrase: string,
  passphrase: string,
): Promise<RecoveryIdentityInput> {
  let payload: RecoveryBundlePayload
  try {
    payload = JSON.parse(json) as RecoveryBundlePayload
  } catch {
    throw new Error('Recovery bundle is not valid JSON.')
  }

  if (payload.bundleVersion !== 2) {
    throw new Error(
      payload.bundleVersion === 1
        ? 'This recovery bundle is an unencrypted v1 export and is no longer accepted. Export a new password-protected bundle.'
        : 'Recovery bundle version is not supported.'
    )
  }
  if (payload.envProfile !== expectedProfile) {
    throw new Error(`Recovery bundle belongs to '${String(payload.envProfile)}', not '${expectedProfile}'.`)
  }
  if (payload.stellarNetworkPassphrase !== expectedNetworkPassphrase) {
    throw new Error('Recovery bundle belongs to a different Stellar network.')
  }
  if (!isEncryptedPayload(payload.encrypted)) {
    throw new Error('Recovery bundle is missing its encrypted payload.')
  }

  const decrypted = JSON.parse(
    await decryptRecoveryPayload(payload.encrypted, passphrase)
  ) as DecryptedRecoveryPayload

  const publicKey = decrypted.wallet?.publicKey
  const secretKey = decrypted.wallet?.secretKey
  if (typeof publicKey !== 'string' || !STELLAR_PUBLIC_KEY.test(publicKey)) {
    throw new Error('Recovery bundle has an invalid Stellar public key.')
  }
  if (typeof secretKey !== 'string' || !STELLAR_SECRET_KEY.test(secretKey)) {
    throw new Error('Recovery bundle has an invalid Stellar secret key.')
  }

  let label = 'Recovered identity'
  if (typeof decrypted.webId === 'string') {
    try {
      const slug = new URL(decrypted.webId).pathname.split('/').filter(Boolean)[0]
      if (slug) label = `Recovered @${slug}`
    } catch {
      // A malformed optional WebID does not invalidate the wallet key material.
    }
  }

  return { secret: secretKey, expectedPublicKey: publicKey, label }
}
