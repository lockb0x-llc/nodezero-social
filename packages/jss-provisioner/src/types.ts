export interface BootstrapChallengeRequest {
  handle: string
  webId: string
  podUrl: string
}

export interface BootstrapChallenge {
  challengeId: string
  nonce: string
  domain: string
  expiresAt: string
  envProfile: string
  handle: string
  webId: string
  podUrl: string
}

export interface ProvisionRequest {
  handle: string
  podSlug: string
  webId: string
  podUrl: string
  stellarPublicKey: string
  challengeId: string
  signatureBase64: string
}

export interface LockboxProvisioning {
  status: 'ready' | 'skipped' | 'error'
  mode: 'mock' | 'disabled' | 'soroban'
  factoryContractId: string | null
  userLockboxContractId: string | null
  idempotencyKey: string
  verifiedAt: string
  error?: string
}

export interface ProvisionResult {
  status: 'ready' | 'pending'
  jobId: string
  lockbox?: LockboxProvisioning
}

export interface ProvisionStatus {
  status: 'pending' | 'ready' | 'error'
  jobId: string
  error?: string
  lockbox?: LockboxProvisioning
  user?: {
    handle: string
    webId: string
    podUrl: string
    issuer: string
    stellarPublicKey: string
  }
  custodyReceipt?: {
    challengeId: string
    verifiedAt: string
    claimHash: string
  }
}
