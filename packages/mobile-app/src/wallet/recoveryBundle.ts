export interface RecoveryIdentityInput {
  secret: string
  expectedPublicKey: string
  label: string
}

interface RecoveryBundlePayload {
  bundleVersion?: unknown
  envProfile?: unknown
  stellarNetworkPassphrase?: unknown
  webId?: unknown
  wallet?: {
    publicKey?: unknown
    secretKey?: unknown
  }
}

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/
const STELLAR_SECRET_KEY = /^S[A-Z2-7]{55}$/

export function parseRecoveryBundle(
  json: string,
  expectedProfile: string,
  expectedNetworkPassphrase: string,
): RecoveryIdentityInput {
  let payload: RecoveryBundlePayload
  try {
    payload = JSON.parse(json) as RecoveryBundlePayload
  } catch {
    throw new Error('Recovery bundle is not valid JSON.')
  }

  if (payload.bundleVersion !== 1) {
    throw new Error('Recovery bundle version is not supported.')
  }
  if (payload.envProfile !== expectedProfile) {
    throw new Error(`Recovery bundle belongs to '${String(payload.envProfile)}', not '${expectedProfile}'.`)
  }
  if (payload.stellarNetworkPassphrase !== expectedNetworkPassphrase) {
    throw new Error('Recovery bundle belongs to a different Stellar network.')
  }

  const publicKey = payload.wallet?.publicKey
  const secretKey = payload.wallet?.secretKey
  if (typeof publicKey !== 'string' || !STELLAR_PUBLIC_KEY.test(publicKey)) {
    throw new Error('Recovery bundle has an invalid Stellar public key.')
  }
  if (typeof secretKey !== 'string' || !STELLAR_SECRET_KEY.test(secretKey)) {
    throw new Error('Recovery bundle has an invalid Stellar secret key.')
  }

  let label = 'Recovered identity'
  if (typeof payload.webId === 'string') {
    try {
      const slug = new URL(payload.webId).pathname.split('/').filter(Boolean)[0]
      if (slug) label = `Recovered @${slug}`
    } catch {
      // A malformed optional WebID does not invalidate the wallet key material.
    }
  }

  return { secret: secretKey, expectedPublicKey: publicKey, label }
}