/**
 * @module DidContract
 *
 * W3C Decentralized Identifier (DID) data models, schemas, and validators
 * for the `did:pkn` (Pakana Lockb0x) DID method.
 */

export const DID_PKN_METHOD = 'pkn'
export const DID_PKN_REGEX = /^did:pkn:(testnet|mainnet|local):([A-Z0-9]{56})$/

export type DidNetwork = 'testnet' | 'mainnet' | 'local'

export interface ParsedDidPkn {
  did: string
  method: 'pkn'
  network: DidNetwork
  contractAddress: string
}

export interface DidVerificationMethod {
  id: string
  type: string
  controller: string
  publicKeyMultibase?: string
  publicKeyJwk?: Record<string, unknown>
  stellarAddress?: string
}

export interface DidService {
  id: string
  type: string
  serviceEndpoint: string | Record<string, unknown>
  description?: string
}

export interface DidDocument {
  '@context': string | string[]
  id: string
  controller?: string | string[]
  alsoKnownAs?: string[]
  verificationMethod?: DidVerificationMethod[]
  authentication?: (string | DidVerificationMethod)[]
  assertionMethod?: (string | DidVerificationMethod)[]
  keyAgreement?: (string | DidVerificationMethod)[]
  capabilityInvocation?: (string | DidVerificationMethod)[]
  capabilityDelegation?: (string | DidVerificationMethod)[]
  service?: DidService[]
}

export interface DidResolutionMetadata {
  contentType?: string
  error?: 'invalidDid' | 'notFound' | 'representationNotSupported' | 'internalError' | string
  errorMessage?: string
  retrieved?: string
}

export interface DidDocumentMetadata {
  created?: string
  updated?: string
  deactivated?: boolean
  versionId?: string
  nextVersionId?: string
  canonicalId?: string
}

export interface DidResolutionResult {
  '@context': string
  didDocument: DidDocument | null
  didDocumentMetadata: DidDocumentMetadata
  didResolutionMetadata: DidResolutionMetadata
}

export function parseDidPkn(did: string): ParsedDidPkn | null {
  const match = did.trim().match(DID_PKN_REGEX)
  if (!match) return null

  return {
    did: did.trim(),
    method: 'pkn',
    network: match[1] as DidNetwork,
    contractAddress: match[2] as string,
  }
}

export function isValidDidPkn(did: string): boolean {
  return DID_PKN_REGEX.test(did.trim())
}
