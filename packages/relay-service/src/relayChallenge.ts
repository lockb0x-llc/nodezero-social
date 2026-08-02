import { randomBytes } from 'node:crypto'
import { Keypair } from '@stellar/stellar-sdk'

export function createRelayIdentityChallenge(
  webId: string,
  stellarPublicKey: string,
  nonce = randomBytes(32).toString('base64url')
): string {
  return `NZ_RELAY_AUTH_V1|${nonce}|${webId}|${stellarPublicKey}`
}

export function verifyRelayIdentitySignature(
  challenge: string,
  stellarPublicKey: string,
  signatureBase64: string
): boolean {
  try {
    return Keypair.fromPublicKey(stellarPublicKey).verify(
      Buffer.from(challenge, 'utf8'),
      Buffer.from(signatureBase64, 'base64')
    )
  } catch {
    return false
  }
}
