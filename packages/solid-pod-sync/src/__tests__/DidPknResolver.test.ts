import {
  parseDidPkn,
  isValidDidPkn,
  type DidNetwork,
} from '../contracts/DidContract.js'
import {
  DidPknResolver,
  createDidPknDocument,
  decodeStellarAddressToBytes,
  encodeBase58,
  encodeEd25519PublicKeyMultibase,
  type LockboxContractData,
} from '../DidPknResolver.js'

describe('W3C did:pkn Decentralized Identifier Resolver', () => {
  const TEST_STELLAR_PUBKEY = 'GB7P35TY56RILQHQOEXOHPR6O3OD6I62E4S5L3F3WFF7K332463F7YQI'
  const TEST_CONTRACT = 'CBFWY2ZF73N5SDH4PQFPR7E5SHWTMMPJOI4ZT675CQLXBYDGNR2VCSPO'
  const TEST_DID = `did:pkn:testnet:${TEST_CONTRACT}`

  describe('DID Syntax Validation', () => {
    it('parses valid testnet, mainnet, and local did:pkn identifiers', () => {
      const testnet = parseDidPkn(`did:pkn:testnet:${TEST_CONTRACT}`)
      expect(testnet).toEqual({
        did: `did:pkn:testnet:${TEST_CONTRACT}`,
        method: 'pkn',
        network: 'testnet',
        contractAddress: TEST_CONTRACT,
      })

      const mainnet = parseDidPkn(`did:pkn:mainnet:${TEST_CONTRACT}`)
      expect(mainnet).toEqual({
        did: `did:pkn:mainnet:${TEST_CONTRACT}`,
        method: 'pkn',
        network: 'mainnet',
        contractAddress: TEST_CONTRACT,
      })

      const local = parseDidPkn(`did:pkn:local:${TEST_CONTRACT}`)
      expect(local).toEqual({
        did: `did:pkn:local:${TEST_CONTRACT}`,
        method: 'pkn',
        network: 'local',
        contractAddress: TEST_CONTRACT,
      })
    })

    it('rejects malformed DID identifiers', () => {
      expect(parseDidPkn('did:example:12345')).toBeNull()
      expect(parseDidPkn('did:pkn:invalidnet:CBFWY2ZF73N5SDH4PQFPR7E5SHWTMMPJOI4ZT675CQLXBYDGNR2VCSPO')).toBeNull()
      expect(parseDidPkn('did:pkn:testnet:tooshort')).toBeNull()
      expect(isValidDidPkn('not-a-did')).toBe(false)
    })
  })

  describe('Base58 & Multibase Multicodec Encoding', () => {
    it('decodes Stellar G-address to 32 raw public key bytes', () => {
      const rawBytes = decodeStellarAddressToBytes(TEST_STELLAR_PUBKEY)
      expect(rawBytes).not.toBeNull()
      expect(rawBytes?.length).toBe(32)
    })

    it('returns null for invalid Stellar address strings', () => {
      expect(decodeStellarAddressToBytes('invalid')).toBeNull()
      expect(decodeStellarAddressToBytes('SB7P35TY56RILQHQOEXOHPR6O3OD6I62E4S5L3F3WFF7K332463F7YQI')).toBeNull() // S address (secret)
    })

    it('encodes byte buffers to base58 and multibase z-strings', () => {
      const rawBytes = decodeStellarAddressToBytes(TEST_STELLAR_PUBKEY)!
      const base58 = encodeBase58(rawBytes)
      expect(base58.length).toBeGreaterThan(0)

      const multibase = encodeEd25519PublicKeyMultibase(rawBytes)
      expect(multibase.startsWith('z')).toBe(true)
    })
  })

  describe('DID Document Generation', () => {
    it('generates a schema-compliant W3C DID document with services', () => {
      const doc = createDidPknDocument({
        did: TEST_DID,
        stellarPublicKey: TEST_STELLAR_PUBKEY,
        webId: 'https://solid.nodezero.social/alice/profile/card#me',
        wakuTopic: '/nodezero-staging/1/h3-881f1d4893fffff/proto',
        relayUrl: 'wss://relay.staging.nodezero.social/ws',
      })

      expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1')
      expect(doc['@context']).toContain('https://w3id.org/security/suites/ed25519-2020/v1')
      expect(doc.id).toBe(TEST_DID)
      expect(doc.controller).toBe(TEST_DID)
      expect(doc.alsoKnownAs).toEqual(['https://solid.nodezero.social/alice/profile/card#me'])

      expect(doc.verificationMethod).toHaveLength(1)
      const vm = doc.verificationMethod![0]
      expect(vm.id).toBe(`${TEST_DID}#stellar-key`)
      expect(vm.type).toBe('Ed25519VerificationKey2020')
      expect(vm.controller).toBe(TEST_DID)
      expect(vm.stellarAddress).toBe(TEST_STELLAR_PUBKEY)
      expect(vm.publicKeyMultibase?.startsWith('z')).toBe(true)

      expect(doc.authentication).toEqual([`${TEST_DID}#stellar-key`])
      expect(doc.assertionMethod).toEqual([`${TEST_DID}#stellar-key`])

      expect(doc.service).toHaveLength(3)
      expect(doc.service?.find(s => s.type === 'SolidPodStorage')?.serviceEndpoint).toBe(
        'https://solid.nodezero.social/alice/profile/card#me',
      )
      expect(doc.service?.find(s => s.type === 'WakuDiscoveryService')?.serviceEndpoint).toBe(
        '/nodezero-staging/1/h3-881f1d4893fffff/proto',
      )
      expect(doc.service?.find(s => s.type === 'SignalingRelayService')?.serviceEndpoint).toBe(
        'wss://relay.staging.nodezero.social/ws',
      )
    })
  })

  describe('DidPknResolver', () => {
    it('resolves existing lockbox identity to DidResolutionResult', async () => {
      const mockLookup = async (contractAddress: string, network: DidNetwork): Promise<LockboxContractData | null> => {
        if (contractAddress === TEST_CONTRACT && network === 'testnet') {
          return {
            contractAddress: TEST_CONTRACT,
            stellarPublicKey: TEST_STELLAR_PUBKEY,
            webId: 'https://solid.nodezero.social/alice/profile/card#me',
            wakuTopic: '/nodezero-staging/1/h3-881f1d4893fffff/proto',
            createdAt: '2026-08-01T00:00:00.000Z',
          }
        }
        return null
      }

      const resolver = new DidPknResolver(mockLookup)
      const result = await resolver.resolve(TEST_DID)

      expect(result['@context']).toBe('https://w3id.org/did-resolution/v1')
      expect(result.didResolutionMetadata.error).toBeUndefined()
      expect(result.didResolutionMetadata.contentType).toBe('application/did+ld+json')
      expect(result.didDocument?.id).toBe(TEST_DID)
      expect(result.didDocument?.service).toHaveLength(2)
      expect(result.didDocumentMetadata.canonicalId).toBe(TEST_DID)
      expect(result.didDocumentMetadata.deactivated).toBe(false)
    })

    it('NC-02: omits created/updated rather than fabricating them from resolution time', async () => {
      const resolver = new DidPknResolver(async () => ({
        contractAddress: TEST_CONTRACT,
        stellarPublicKey: TEST_STELLAR_PUBKEY,
        webId: 'https://solid.nodezero.social/alice/profile/card#me',
      }))

      const first = await resolver.resolve(TEST_DID)
      const second = await resolver.resolve(TEST_DID)

      expect(first.didDocumentMetadata.created).toBeUndefined()
      expect(first.didDocumentMetadata.updated).toBeUndefined()
      // Two resolutions of the same DID must agree.
      expect(first.didDocumentMetadata).toEqual(second.didDocumentMetadata)
    })

    it('NC-02: surfaces ledger timestamps when the source provides them', async () => {
      const resolver = new DidPknResolver(async () => ({
        contractAddress: TEST_CONTRACT,
        stellarPublicKey: TEST_STELLAR_PUBKEY,
        webId: 'https://solid.nodezero.social/alice/profile/card#me',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
      }))

      const result = await resolver.resolve(TEST_DID)

      expect(result.didDocumentMetadata.created).toBe('2026-08-01T00:00:00.000Z')
      expect(result.didDocumentMetadata.updated).toBe('2026-08-09T00:00:00.000Z')
    })

    it('NC-02: a deactivated DID resolves to a null document per DID Core', async () => {
      const resolver = new DidPknResolver(async () => ({
        contractAddress: TEST_CONTRACT,
        stellarPublicKey: TEST_STELLAR_PUBKEY,
        webId: 'https://solid.nodezero.social/alice/profile/card#me',
        deactivated: true,
      }))

      const result = await resolver.resolve(TEST_DID)

      expect(result.didDocument).toBeNull()
      expect(result.didDocumentMetadata.deactivated).toBe(true)
      expect(result.didResolutionMetadata.error).toBeUndefined()
    })

    it('returns notFound resolution metadata when contract does not exist', async () => {
      const resolver = new DidPknResolver(async () => null)
      const result = await resolver.resolve(TEST_DID)

      expect(result.didDocument).toBeNull()
      expect(result.didResolutionMetadata.error).toBe('notFound')
    })

    it('returns invalidDid resolution metadata when DID string is malformed', async () => {
      const resolver = new DidPknResolver()
      const result = await resolver.resolve('did:other:123')

      expect(result.didDocument).toBeNull()
      expect(result.didResolutionMetadata.error).toBe('invalidDid')
    })

    it('handles lookup exceptions gracefully with internalError metadata', async () => {
      const resolver = new DidPknResolver(async () => {
        throw new Error('RPC endpoint timeout')
      })
      const result = await resolver.resolve(TEST_DID)

      expect(result.didDocument).toBeNull()
      expect(result.didResolutionMetadata.error).toBe('internalError')
      expect(result.didResolutionMetadata.errorMessage).toContain('RPC endpoint timeout')
    })
  })
})
