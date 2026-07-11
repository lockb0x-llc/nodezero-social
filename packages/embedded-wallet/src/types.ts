/**
 * @module types
 * Shared type definitions for the embedded-wallet package.
 */

/** Information about the local embedded wallet. */
export interface WalletInfo {
  /** The Stellar public key (G… address) derived from the stored secret. */
  publicKey: string
  /**
   * Indicates whether this wallet has been funded on the Stellar network
   * (i.e., has a minimum balance and an active account).
   */
  isFunded: boolean
}

/** Result returned by {@link WalletService} after submitting a transaction. */
export interface TransactionResult {
  /** Stellar transaction hash. */
  hash: string
  /** `true` if the transaction was accepted by the network. */
  success: boolean
  /** Ledger number in which the transaction was included. */
  ledger?: number
}

/**
 * Payload submitted to the `NodeZeroIdentity` Soroban contract when a user
 * registers their Solid WebID on-chain.
 */
export interface IdentityHashPayload {
  /** The user's Solid Pod WebID URL. */
  webId: string
  /** The Stellar public key of the embedded wallet. */
  stellarPublicKey: string
}

/** Result returned after signing a custody attestation challenge payload. */
export interface AttestationSignature {
  /** Signer public key (G... address). */
  stellarPublicKey: string
  /** Original challenge payload bytes encoded as UTF-8 string. */
  challengePayload: string
  /** Ed25519 signature encoded as base64. */
  signatureBase64: string
}

/** Inputs used to derive a deterministic bootstrap password. */
export interface BootstrapPasswordInput {
  issuer: string
  handle: string
  notificationEmail: string
  stellarPublicKey: string
}
