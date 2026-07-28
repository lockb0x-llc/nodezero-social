import type { WalletIdentitySummary } from '../contexts/WalletContext'

export interface UsableIdentityCandidate {
  keyId: string
  stellarPublicKey: string
  active: boolean
}

export function usableIdentityCandidates(
  summaries: WalletIdentitySummary[],
): UsableIdentityCandidate[] {
  return summaries
    .filter(
      (identity): identity is WalletIdentitySummary & { stellarPublicKey: string } =>
        identity.secretAvailable && Boolean(identity.stellarPublicKey),
    )
    .map(({ keyId, stellarPublicKey, active }) => ({ keyId, stellarPublicKey, active }))
    .sort((left, right) => Number(right.active) - Number(left.active))
}
