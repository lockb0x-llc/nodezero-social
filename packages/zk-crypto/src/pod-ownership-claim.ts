export interface PodOwnershipClaim {
  /** Circuit/claim schema version. Defaults to legacy pod_ownership V2. */
  circuitVersion?: number
  envProfile: string
  stellarNetworkPassphrase: string
  webId: string
  podUrl: string
  stellarPublicKey: string
  identityContractId: string
  lockboxFactoryContractId: string
  challengeId: string
  nonce: string
  expiresAt: string
  /** Active onboarding descriptor fingerprint. Required for V3 claims. */
  configFingerprint?: string
}

function canonicalField(value: string): string {
  return value.trim()
}

function canonicalPodUrl(value: string): string {
  const trimmed = value.trim()
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

export function buildPodOwnershipClaim(claim: PodOwnershipClaim): string {
  const fields = [
    claim.circuitVersion === 3 ? 'NZ_POD_STELLAR_BRIDGE_V3' : 'NZ_POD_OWNER_V1',
    String(claim.circuitVersion ?? 2),
    canonicalField(claim.envProfile),
    canonicalField(claim.stellarNetworkPassphrase),
    canonicalField(claim.webId),
    canonicalPodUrl(claim.podUrl),
    canonicalField(claim.stellarPublicKey),
    canonicalField(claim.identityContractId),
    canonicalField(claim.lockboxFactoryContractId),
    canonicalField(claim.challengeId),
    canonicalField(claim.nonce),
    canonicalField(claim.expiresAt),
  ]
  if (claim.circuitVersion === 3) {
    const configFingerprint = canonicalField(claim.configFingerprint ?? '')
    if (!/^[0-9a-f]{64}$/.test(configFingerprint)) {
      throw new Error('V3 Pod ownership claims require a 32-byte configuration fingerprint.')
    }
    fields.push(configFingerprint)
  }
  return fields.join('|')
}