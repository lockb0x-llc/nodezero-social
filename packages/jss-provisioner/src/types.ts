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
  identityContractId: string
  lockboxFactoryContractId: string
  challengeId: string
  signatureBase64: string
  proofVersion: number
  claimHash: string
  proofHex: string
  proofHashHex: string
  proofRootHex: string
  publicSignals: string[]
}

export interface LockboxProvisioning {
  status: 'ready' | 'skipped' | 'error'
  mode: 'mock' | 'disabled' | 'soroban'
  factoryContractId: string | null
  userLockboxContractId: string | null
  idempotencyKey: string
  verifiedAt: string
  proofRootHex?: string
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
    proofHashHex?: string
    proofRootHex?: string
  }
}

export interface OidcBridgeTicket {
  token: string
  expiresAt: string
}

export interface OidcBridgeConsumeRequest {
  token: string
}
