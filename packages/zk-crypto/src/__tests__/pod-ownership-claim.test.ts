import { buildPodOwnershipClaim } from '../pod-ownership-claim.js'

const baseClaim = {
  circuitVersion: 3,
  envProfile: 'staging-testnet',
  stellarNetworkPassphrase: 'Test SDF Network ; September 2015',
  webId: 'https://solid.nodezero.social/alice/profile/card#me',
  podUrl: 'https://solid.nodezero.social/alice/',
  stellarPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  identityContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
  lockboxFactoryContractId: 'CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAG4',
  challengeId: 'nz-seamless-v1',
  nonce: 'nz-seamless-v1',
  expiresAt: 'nz-seamless-v1',
  configFingerprint: 'f'.repeat(64),
}

describe('buildPodOwnershipClaim', () => {
  test('serializes the V3 bridge claim in the canonical field order', () => {
    expect(buildPodOwnershipClaim(baseClaim)).toBe(
      [
        'NZ_POD_STELLAR_BRIDGE_V3',
        '3',
        'staging-testnet',
        'Test SDF Network ; September 2015',
        'https://solid.nodezero.social/alice/profile/card#me',
        'https://solid.nodezero.social/alice/',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        'CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAG4',
        'nz-seamless-v1',
        'nz-seamless-v1',
        'nz-seamless-v1',
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      ].join('|'),
    )
  })

  test('trims fields and adds exactly one trailing Pod slash', () => {
    expect(
      buildPodOwnershipClaim({
        ...baseClaim,
        envProfile: ' staging-testnet ',
        podUrl: ' https://solid.nodezero.social/alice ',
      }),
    ).toBe(buildPodOwnershipClaim(baseClaim))
  })

  test('uses the legacy domain and default version when circuitVersion is absent', () => {
    const { circuitVersion: _circuitVersion, ...legacyClaim } = baseClaim
    expect(
      buildPodOwnershipClaim(legacyClaim).split('|').slice(0, 2),
    ).toEqual(['NZ_POD_OWNER_V1', '2'])
  })

  test('rejects V3 claims without a configuration fingerprint', () => {
    const { configFingerprint: _configFingerprint, ...claim } = baseClaim
    expect(() => buildPodOwnershipClaim(claim)).toThrow(/configuration fingerprint/)
  })
})
