import { createHash } from 'node:crypto'
import { createPublicKey, verify as verifySignature } from 'node:crypto'
import type { BootstrapChallenge, ProvisionRequest } from './types.js'

const STELLAR_ACCOUNT_VERSION_BYTE = 6 << 3
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const SNARK_FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

export interface VerifiedAttestation {
  challengeMessage: string
  canonicalClaim: string
  podBindingHash: string
  claimHash: string
  proofHashHex: string
  proofRootHex: string
}

function crc16Xmodem(payload: Uint8Array): number {
  let crc = 0x0000
  for (const byte of payload) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff
      } else {
        crc = (crc << 1) & 0xffff
      }
    }
  }
  return crc
}

function decodeBase32(input: string): Uint8Array {
  let buffer = 0
  let bitsLeft = 0
  const bytes: number[] = []

  for (const char of input.toUpperCase()) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value < 0) {
      throw new Error('Stellar public key is not valid base32.')
    }

    buffer = (buffer << 5) | value
    bitsLeft += 5

    while (bitsLeft >= 8) {
      bitsLeft -= 8
      bytes.push((buffer >> bitsLeft) & 0xff)
    }
  }

  return Uint8Array.from(bytes)
}

function decodeStellarEd25519PublicKey(stellarPublicKey: string): Buffer {
  const decoded = decodeBase32(stellarPublicKey)
  if (decoded.length !== 35) {
    throw new Error('Stellar public key decoded length is invalid.')
  }

  const payload = decoded.slice(0, 33)
  const checksum = decoded.slice(33)

  const expectedChecksum = crc16Xmodem(payload)
  const actualChecksum = checksum[0] | (checksum[1] << 8)
  if (expectedChecksum !== actualChecksum) {
    throw new Error('Stellar public key checksum mismatch.')
  }

  const version = payload[0]
  if (version !== STELLAR_ACCOUNT_VERSION_BYTE) {
    throw new Error('Stellar public key version byte is invalid.')
  }

  return Buffer.from(payload.slice(1))
}

function ed25519PublicKeyToSpki(rawKey: Buffer): Buffer {
  // ASN.1 DER prefix for Ed25519 SubjectPublicKeyInfo.
  const prefix = Buffer.from('302a300506032b6570032100', 'hex')
  return Buffer.concat([prefix, rawKey])
}

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

function canonicalPodUrl(value: string): string {
  const trimmed = value.trim()
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

export function canonicalizePodOwnershipClaim(
  request: ProvisionRequest,
  challenge: BootstrapChallenge
): string {
  return [
    'NZ_POD_OWNER_V1',
    challenge.envProfile.trim(),
    (process.env.JSS_STELLAR_NETWORK_PASSPHRASE ??
      process.env.NZ_STELLAR_NETWORK_PASSPHRASE ??
      'Test SDF Network ; September 2015').trim(),
    challenge.webId.trim(),
    canonicalPodUrl(challenge.podUrl),
    request.stellarPublicKey.trim(),
    request.identityContractId.trim(),
    request.lockboxFactoryContractId.trim(),
    challenge.challengeId.trim(),
    challenge.nonce.trim(),
    challenge.expiresAt.trim(),
  ].join('|')
}

function decodeSignatureBase64(signatureBase64: string): Buffer {
  try {
    return Buffer.from(signatureBase64, 'base64')
  } catch {
    throw new Error('Signature is not valid base64.')
  }
}

function verifyStellarSignature(
  stellarPublicKey: string,
  payload: Buffer,
  signatureBytes: Buffer,
): boolean {
  const rawPublicKey = decodeStellarEd25519PublicKey(stellarPublicKey)
  const spki = ed25519PublicKeyToSpki(rawPublicKey)
  const keyObject = createPublicKey({ key: spki, format: 'der', type: 'spki' })
  return verifySignature(null, payload, keyObject, signatureBytes)
}

function hashPodBinding(webId: string, podUrl: string): string {
  return createHash('sha256').update(`${webId}\n${podUrl}`, 'utf8').digest('hex')
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function hashClaimToField(canonicalClaim: string): string {
  return (BigInt(`0x${sha256Hex(canonicalClaim)}`) % SNARK_FIELD_SIZE).toString()
}

function normalizeHex(value: string, label: string): string {
  const normalized = value.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new Error(`${label} must be hex encoded.`)
  }
  return normalized
}

function publicSignalBytes(signal: string): Buffer {
  const hex = BigInt(signal).toString(16).padStart(64, '0')
  return Buffer.from(hex, 'hex')
}

function computeProofHashHex(proofHex: string, publicSignals: string[]): string {
  const proofBytes = Buffer.from(normalizeHex(proofHex, 'proofHex'), 'hex')
  const signalBytes = publicSignals.map(publicSignalBytes)
  return sha256Hex(Buffer.concat([proofBytes, ...signalBytes]))
}

function requireProofFields(request: ProvisionRequest): void {
  if (request.proofVersion !== 1) throw new Error('Unsupported proofVersion.')
  if (!Array.isArray(request.publicSignals) || request.publicSignals.length !== 3) {
    throw new Error('publicSignals must contain claimHash, accountCommitment, and podBinding.')
  }
  for (const signal of request.publicSignals) {
    if (typeof signal !== 'string' || !/^\d+$/.test(signal.trim())) {
      throw new Error('publicSignals must be decimal field elements.')
    }
  }
  normalizeHex(request.proofHex, 'proofHex')
  const proofHashHex = normalizeHex(request.proofHashHex, 'proofHashHex')
  if (proofHashHex.length !== 64) throw new Error('proofHashHex must be 32 bytes.')
  const proofRootHex = normalizeHex(request.proofRootHex, 'proofRootHex')
  if (proofRootHex.length !== 64) throw new Error('proofRootHex must be 32 bytes.')
}

export function verifyAttestation(
  request: ProvisionRequest,
  challenge: BootstrapChallenge
): VerifiedAttestation {
  if (request.handle.trim() !== challenge.handle) {
    throw new Error('Challenge handle mismatch.')
  }
  if (request.webId.trim() !== challenge.webId) {
    throw new Error('Challenge webId mismatch.')
  }
  if (request.podUrl.trim() !== challenge.podUrl) {
    throw new Error('Challenge podUrl mismatch.')
  }
  if (request.lockboxFactoryContractId.trim().length === 0) {
    throw new Error('lockboxFactoryContractId is required.')
  }
  if (request.identityContractId.trim().length === 0) {
    throw new Error('identityContractId is required.')
  }

  requireProofFields(request)

  const challengeMessage = canonicalizeChallenge(challenge)
  const payload = Buffer.from(challengeMessage, 'utf8')
  const signatureBytes = decodeSignatureBase64(request.signatureBase64)

  const valid = verifyStellarSignature(request.stellarPublicKey, payload, signatureBytes)

  if (!valid) {
    throw new Error('Stellar signature verification failed.')
  }

  const canonicalClaim = canonicalizePodOwnershipClaim(request, challenge)
  const claimHash = hashClaimToField(canonicalClaim)
  if (request.claimHash.trim() !== claimHash) {
    throw new Error('Proof claimHash does not match canonical Pod ownership claim.')
  }
  if (request.publicSignals[0].trim() !== claimHash) {
    throw new Error('Proof public claimHash signal does not match canonical Pod ownership claim.')
  }

  const proofHashHex = computeProofHashHex(request.proofHex, request.publicSignals)
  if (normalizeHex(request.proofHashHex, 'proofHashHex') !== proofHashHex) {
    throw new Error('proofHashHex does not match proof bytes and public signals.')
  }

  const proofRootHex = sha256Hex(`${canonicalClaim}|${proofHashHex}`)
  if (normalizeHex(request.proofRootHex, 'proofRootHex') !== proofRootHex) {
    throw new Error('proofRootHex does not match canonical claim and proof hash.')
  }

  return {
    challengeMessage,
    canonicalClaim,
    podBindingHash: hashPodBinding(challenge.webId, challenge.podUrl),
    claimHash,
    proofHashHex,
    proofRootHex,
  }
}
