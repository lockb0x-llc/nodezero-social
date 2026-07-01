/**
 * Tests for the Stellar-derived attestation cipher and off-chain login
 * verification (Phase C).
 */

import {
  encryptAttestation,
  decryptAttestation,
  verifyLoginAttestation,
  fieldToBytes32Hex,
} from '../attestation-cipher.js'
import {
  buildPodOwnershipClaim,
  generatePodOwnershipProof,
  type PodOwnershipClaim,
} from '../pod-ownership-prover.js'

const SECRET = 'SBTESTSECRETKEYFORATTESTATIONCIPHERUNITTESTONLY0000000000'
const OTHER_SECRET = 'SBDIFFERENTSECRETKEYSHOULDNOTDECRYPT0000000000000000000000'

const CLAIM: PodOwnershipClaim = {
  envProfile: 'staging-testnet',
  stellarNetworkPassphrase: 'Test SDF Network ; September 2015',
  webId: 'https://solid.nodezero.social/alice/profile/card#me',
  podUrl: 'https://solid.nodezero.social/alice/',
  stellarPublicKey: 'GAUMNOPBK5WYUGIV2VH7JXMHACFSB4QV4HCJM5LB7ERUYKUN6UEZGEYI',
  identityContractId: 'CCHFYOKLGVTXEYYHWEFPI22FR26VRGG2CBBUTP6XPW3ZSIWIKEVQQ44K',
  lockboxFactoryContractId: 'CA5MASVC7CH646QUZM6HFC3JAYIG4TCRHJDSBDOBFP66IW7TXYYHFUVB',
  challengeId: 'challenge-abc-123',
  nonce: 'nonce-xyz-789',
  expiresAt: '2026-07-01T12:00:00.000Z',
}

describe('attestation cipher (AES-256-GCM, Stellar-derived key)', () => {
  it('round-trips encrypt -> decrypt with the same Stellar secret', async () => {
    const claim = buildPodOwnershipClaim(CLAIM)
    const enc = await encryptAttestation(claim, SECRET)
    expect(enc.hex).toMatch(/^01[0-9a-f]+$/)
    expect(enc.sha256Hex).toHaveLength(64)

    const roundTrip = await decryptAttestation(enc.bytes, SECRET)
    expect(roundTrip).toBe(claim)

    // hex form also decrypts
    const fromHex = await decryptAttestation(enc.hex, SECRET)
    expect(fromHex).toBe(claim)
  })

  it('fails to decrypt with a different Stellar secret', async () => {
    const enc = await encryptAttestation('recover-me', SECRET)
    await expect(decryptAttestation(enc.bytes, OTHER_SECRET)).rejects.toThrow()
  })

  it('rejects a tampered ciphertext (GCM auth failure)', async () => {
    const enc = await encryptAttestation('recover-me', SECRET)
    const tampered = Uint8Array.from(enc.bytes)
    tampered[tampered.length - 1] ^= 0xff
    await expect(decryptAttestation(tampered, SECRET)).rejects.toThrow()
  })
})

describe('off-chain login attestation (pod_ownership proof)', () => {
  it('verifies a valid proof bound to the claim and on-chain anchor', async () => {
    const generated = await generatePodOwnershipProof({ stellarSecretKey: SECRET, claim: CLAIM })
    const onchainHex = fieldToBytes32Hex(generated.accountCommitment.toString())

    const ok = await verifyLoginAttestation({
      proof: generated.proof,
      publicSignals: generated.publicSignals,
      claim: CLAIM,
      onchainAccountCommitmentHex: onchainHex,
    })
    expect(ok.valid).toBe(true)
  }, 60_000)

  it('rejects when the on-chain anchor does not match the proof', async () => {
    const generated = await generatePodOwnershipProof({ stellarSecretKey: SECRET, claim: CLAIM })
    const wrongHex = fieldToBytes32Hex((generated.accountCommitment + 1n).toString())

    const res = await verifyLoginAttestation({
      proof: generated.proof,
      publicSignals: generated.publicSignals,
      claim: CLAIM,
      onchainAccountCommitmentHex: wrongHex,
    })
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/anchor/i)
  }, 60_000)

  it('rejects when the claim is tampered (claimHash mismatch)', async () => {
    const generated = await generatePodOwnershipProof({ stellarSecretKey: SECRET, claim: CLAIM })
    const onchainHex = fieldToBytes32Hex(generated.accountCommitment.toString())

    const res = await verifyLoginAttestation({
      proof: generated.proof,
      publicSignals: generated.publicSignals,
      claim: { ...CLAIM, webId: 'https://solid.nodezero.social/mallory/profile/card#me' },
      onchainAccountCommitmentHex: onchainHex,
    })
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/claim/i)
  }, 60_000)
})
