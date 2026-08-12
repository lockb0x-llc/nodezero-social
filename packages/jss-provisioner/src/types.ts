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

export interface OidcBridgeTicket {
  token: string
  expiresAt: string
}

// ---------------------------------------------------------------------------
// Stellar Auth
// ---------------------------------------------------------------------------

/** Short-lived challenge issued to a Stellar keypair holder during returning-user sign-in. */
export interface StellarAuthChallenge {
  challengeId: string
  nonce: string
  stellarPublicKey: string
  expiresAt: string
}

export interface StellarChallengeRequest {
  stellarPublicKey: string
}

export interface StellarTokenRequest {
  challengeId: string
  stellarPublicKey: string
  signatureBase64: string
  webId?: string
}
