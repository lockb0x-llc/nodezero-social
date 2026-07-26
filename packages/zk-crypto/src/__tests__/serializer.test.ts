import { podOwnershipProofToBridgeArgs } from '../serializer.js'

describe('podOwnershipProofToBridgeArgs', () => {
  const proof = {
    pi_a: ['1', '2', '1'],
    pi_b: [['3', '4'], ['5', '6'], ['1', '0']],
    pi_c: ['7', '8', '1'],
    protocol: 'groth16',
    curve: 'bn128',
  }

  it('serializes proof and public signals in circuit order', () => {
    const encoded = podOwnershipProofToBridgeArgs(proof, ['9', '10', '11'])

    expect(encoded.proofHex).toHaveLength(512)
    expect(encoded.claimHashHex).toHaveLength(64)
    expect(encoded.accountCommitmentHex).toHaveLength(64)
    expect(encoded.podBindingHex).toHaveLength(64)
    expect(encoded.claimHashHex.endsWith('09')).toBe(true)
    expect(encoded.accountCommitmentHex.endsWith('0a')).toBe(true)
    expect(encoded.podBindingHex.endsWith('0b')).toBe(true)
  })

  it('rejects a public-signal list that cannot match the bridge circuit', () => {
    expect(() => podOwnershipProofToBridgeArgs(proof, ['9', '10'])).toThrow('pod_ownership proof')
  })
})