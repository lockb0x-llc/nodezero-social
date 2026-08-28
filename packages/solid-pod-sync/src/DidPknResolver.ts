/**
 * @module DidPknResolver
 *
 * W3C Decentralized Identifier (DID) resolver for the `did:pkn` method,
 * resolving Soroban Lockb0x smart contract accounts to verified W3C DID Documents
 * with cryptographic verification methods, Solid Pod endpoints, and Waku mesh services.
 */

import {
  type DidDocument,
  type DidDocumentMetadata,
  type DidNetwork,
  type DidResolutionResult,
  type ParsedDidPkn,
  parseDidPkn,
} from './contracts/DidContract.js'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const BASE32_MAP: Record<string, number> = {}
for (let i = 0; i < BASE32_ALPHABET.length; i++) {
  BASE32_MAP[BASE32_ALPHABET[i]] = i
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function decodeStellarAddressToBytes(stellarAddress: string): Uint8Array | null {
  const clean = stellarAddress.trim().toUpperCase()
  if (clean.length !== 56 || clean[0] !== 'G') return null

  const bytes = new Uint8Array(35)
  let buffer = 0
  let bitsLeft = 0
  let byteIndex = 0

  for (let i = 0; i < clean.length; i++) {
    const val = BASE32_MAP[clean[i]]
    if (val === undefined) return null
    buffer = (buffer << 5) | val
    bitsLeft += 5
    if (bitsLeft >= 8) {
      bitsLeft -= 8
      if (byteIndex < 35) {
        bytes[byteIndex++] = (buffer >> bitsLeft) & 0xff
      }
    }
  }

  if (bytes[0] !== 0x30) return null
  return bytes.slice(1, 33)
}

export function encodeBase58(bytes: Uint8Array): string {
  const digits: number[] = [0]
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i]
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }

  let leadingZeros = 0
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    leadingZeros++
  }

  let result = '1'.repeat(leadingZeros)
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]]
  }
  return result
}

export function encodeMultibaseBase58Btc(bytes: Uint8Array): string {
  return `z${encodeBase58(bytes)}`
}

export function encodeEd25519PublicKeyMultibase(publicKeyBytes: Uint8Array): string {
  const prefixed = new Uint8Array(2 + publicKeyBytes.length)
  prefixed[0] = 0xed
  prefixed[1] = 0x01
  prefixed.set(publicKeyBytes, 2)
  return encodeMultibaseBase58Btc(prefixed)
}

export interface LockboxContractData {
  contractAddress: string
  stellarPublicKey: string
  webId?: string
  wakuTopic?: string
  relayUrl?: string
  zkCommitment?: string
  createdAt?: string
  updatedAt?: string
  deactivated?: boolean
}

export interface CreateDidPknDocumentParams {
  did: string
  stellarPublicKey: string
  webId?: string | undefined
  wakuTopic?: string | undefined
  relayUrl?: string | undefined
}

/**
 * Constructs a fully compliant W3C DID Document for a `did:pkn` identity.
 */
export function createDidPknDocument(params: CreateDidPknDocumentParams): DidDocument {
  const { did, stellarPublicKey, webId, wakuTopic, relayUrl } = params
  const rawKeyBytes = decodeStellarAddressToBytes(stellarPublicKey)
  const multibaseKey = rawKeyBytes ? encodeEd25519PublicKeyMultibase(rawKeyBytes) : undefined
  const verificationKeyId = `${did}#stellar-key`

  const services: DidDocument['service'] = []

  if (webId) {
    services.push({
      id: `${did}#solid-pod`,
      type: 'SolidPodStorage',
      serviceEndpoint: webId,
      description: 'Authoritative Solid Pod data storage and ActivityStreams inbox',
    })
  }

  if (wakuTopic) {
    services.push({
      id: `${did}#waku-mesh`,
      type: 'WakuDiscoveryService',
      serviceEndpoint: wakuTopic,
      description: 'Waku decentralized peer-to-peer messaging and discovery shard',
    })
  }

  if (relayUrl) {
    services.push({
      id: `${did}#p2p-relay`,
      type: 'SignalingRelayService',
      serviceEndpoint: relayUrl,
      description: 'WebSocket signaling relay for direct WebRTC peer connections',
    })
  }

  const doc: DidDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    controller: did,
    verificationMethod: [
      {
        id: verificationKeyId,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        stellarAddress: stellarPublicKey,
        ...(multibaseKey ? { publicKeyMultibase: multibaseKey } : {}),
      },
    ],
    authentication: [verificationKeyId],
    assertionMethod: [verificationKeyId],
    capabilityInvocation: [verificationKeyId],
    capabilityDelegation: [verificationKeyId],
  }

  if (webId) {
    doc.alsoKnownAs = [webId]
  }

  if (services.length > 0) {
    doc.service = services
  }

  return doc
}

export type LockboxLookupFn = (
  contractAddress: string,
  network: DidNetwork,
) => Promise<LockboxContractData | null>

/**
 * Universal DID Resolver implementation for the `did:pkn` method.
 */
export class DidPknResolver {
  private readonly lookupFn?: LockboxLookupFn | undefined

  constructor(lookupFn?: LockboxLookupFn | undefined) {
    this.lookupFn = lookupFn
  }

  async resolve(did: string): Promise<DidResolutionResult> {
    const parsed: ParsedDidPkn | null = parseDidPkn(did)
    if (!parsed) {
      return {
        '@context': 'https://w3id.org/did-resolution/v1',
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: {
          error: 'invalidDid',
          errorMessage: `The identifier "${did}" is not a valid did:pkn DID. Expected format: did:pkn:<network>:<contractAddress>`,
        },
      }
    }

    if (!this.lookupFn) {
      return {
        '@context': 'https://w3id.org/did-resolution/v1',
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: {
          error: 'notFound',
          errorMessage: 'No lockbox lookup provider configured for DidPknResolver.',
        },
      }
    }

    try {
      const lockboxData = await this.lookupFn(parsed.contractAddress, parsed.network)
      if (!lockboxData) {
        return {
          '@context': 'https://w3id.org/did-resolution/v1',
          didDocument: null,
          didDocumentMetadata: {
            deactivated: false,
          },
          didResolutionMetadata: {
            error: 'notFound',
            errorMessage: `Lockb0x contract account "${parsed.contractAddress}" not found on Stellar ${parsed.network}.`,
          },
        }
      }

      const didDocument = createDidPknDocument({
        did: parsed.did,
        stellarPublicKey: lockboxData.stellarPublicKey,
        webId: lockboxData.webId,
        wakuTopic: lockboxData.wakuTopic,
        relayUrl: lockboxData.relayUrl,
      })

      const didDocumentMetadata: DidDocumentMetadata = {
        deactivated: lockboxData.deactivated ?? false,
        created: lockboxData.createdAt ?? new Date().toISOString(),
        updated: lockboxData.updatedAt ?? new Date().toISOString(),
        canonicalId: parsed.did,
      }

      return {
        '@context': 'https://w3id.org/did-resolution/v1',
        didDocument,
        didDocumentMetadata,
        didResolutionMetadata: {
          contentType: 'application/did+ld+json',
          retrieved: new Date().toISOString(),
        },
      }
    } catch (error) {
      return {
        '@context': 'https://w3id.org/did-resolution/v1',
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: {
          error: 'internalError',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }
}
