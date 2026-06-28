import { createHash } from 'node:crypto'
import { Keypair } from '@stellar/stellar-sdk'
import type { BootstrapChallenge, ProvisionRequest } from './types.js'

function canonicalizeChallenge(challenge: BootstrapChallenge): string {
  return [
    'NZ_ATTEST_V1',
    challenge.domain,
    challenge.envProfile,
    challenge.nonce,
    challenge.expiresAt,
    challenge.handle,
    challenge.webId,
    challenge.podUrl,
  ].join('|')
}

function decodeSignatureBase64(signatureBase64: string): Buffer {
  try {
    return Buffer.from(signatureBase64, 'base64')
  } catch {
    throw new Error('Signature is not valid base64.')
  }
}

function hashPodBinding(webId: string, podUrl: string): string {
  return createHash('sha256').update(`${webId}\n${podUrl}`, 'utf8').digest('hex')
}

export function verifyAttestation(
  request: ProvisionRequest,
  challenge: BootstrapChallenge
): { challengeMessage: string; podBindingHash: string } {
  if (request.handle.trim() !== challenge.handle) {
    throw new Error('Challenge handle mismatch.')
  }
  if (request.webId.trim() !== challenge.webId) {
    throw new Error('Challenge webId mismatch.')
  }
  if (request.podUrl.trim() !== challenge.podUrl) {
    throw new Error('Challenge podUrl mismatch.')
  }

  const challengeMessage = canonicalizeChallenge(challenge)
  const payload = Buffer.from(challengeMessage, 'utf8')
  const signatureBytes = decodeSignatureBase64(request.signatureBase64)

  const keypair = Keypair.fromPublicKey(request.stellarPublicKey)
  const valid = keypair.verify(payload, signatureBytes)

  if (!valid) {
    throw new Error('Stellar signature verification failed.')
  }

  return {
    challengeMessage,
    podBindingHash: hashPodBinding(challenge.webId, challenge.podUrl),
  }
}
