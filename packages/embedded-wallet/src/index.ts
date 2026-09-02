/**
 * @module embedded-wallet
 *
 * Invisible Stellar wallet for NodeZero.social.
 *
 * NodeZero's Web3 mechanics are intentionally hidden from end-users.
 * This package silently provisions and manages a Stellar Ed25519 keypair
 * in the device's secure enclave (iOS Secure Enclave / Android Keystore via
 * `expo-secure-store`), submits signed transactions via the Stellar Horizon
 * API, and abstracts fee sponsoring so users never pay gas.
 *
 * The user never sees a seed phrase, wallet address, or gas fee prompt.
 */

export { EnclaveAdapter, MissingIdentitySecretError, type ISecureStore } from './EnclaveAdapter.js'
export { IndexedDbSecureStore, IndexedDbStorageError } from './IndexedDbSecureStore.js'
export {
  checkWebAuthnPrfSupport,
  deriveKeyFromPrfSecret,
  WebAuthnPrfKeyProvider,
  createHardwareBoundSecureStore,
  registerPrfPasskey,
  assertPrfSecret,
  unlockPrfProvider,
  PrfUnavailableError,
  type WebAuthnCapabilities,
  type WebAuthnPrfOptions,
  type PrfPasskeyRecord,
} from './WebAuthnPrfStore.js'
export {
  StatusL2Adapter,
  StatusL2Error,
  type StatusL2Network,
  type EscrowState,
  type AgentCapabilityEscrowParams,
  type EscrowStatusResult,
  type StatusL2AdapterOptions,
} from './StatusL2Adapter.js'
export { WalletService } from './WalletService.js'
export type {
	WalletInfo,
	WalletIdentity,
	TransactionResult,
	IdentityHashPayload,
	AttestationSignature,
} from './types.js'
