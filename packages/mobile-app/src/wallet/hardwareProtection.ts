/**
 * Hardware protection lifecycle for the web wallet.
 *
 * Binds the IndexedDB wrapping key to a WebAuthn PRF secret so that reading wallet
 * records requires a user-verification gesture. Without this the records are still
 * encrypted, but the wrapping key is origin-bound only — a script running in the page
 * can use it silently.
 *
 * Enabling is opt-in per device: PRF support varies by browser and authenticator, and a
 * PRF-bound store cannot be read without a biometric prompt.
 */

import {
  checkWebAuthnPrfSupport,
  createHardwareBoundSecureStore,
  IndexedDbSecureStore,
  PrfUnavailableError,
  unlockPrfProvider,
  WebAuthnPrfKeyProvider,
  type ISecureStore,
  type PrfPasskeyRecord,
} from '@nodezero/embedded-wallet'

export interface HardwareProtectionState {
  enabled: boolean
  record: PrfPasskeyRecord | null
}

export interface HardwareProtectionDeps {
  profile: string
  indexedDB?: IDBFactory | undefined
  crypto?: Crypto | undefined
  credentialsContainer?: CredentialsContainer | undefined
  rpId?: string | undefined
  readState: () => Promise<HardwareProtectionState>
  writeState: (state: HardwareProtectionState) => Promise<void>
}

/** Record keys that must survive re-wrapping, in addition to per-identity secrets. */
export const KEYRING_INDEX_KEY = 'nodezero.stellar.keyring.index.v1'

export interface MigrationSource {
  keys: readonly string[]
  read: (key: string) => Promise<string | null>
}

/**
 * Re-encrypts every wallet record from `source` into `target`.
 *
 * Returns the number of records migrated. A record that cannot be read is skipped rather
 * than aborting, so one unreadable identity does not strand the rest of the keyring.
 */
export async function migrateWalletRecords(
  source: MigrationSource,
  target: ISecureStore
): Promise<{ migrated: number; skipped: string[] }> {
  const skipped: string[] = []
  let migrated = 0

  for (const key of source.keys) {
    let value: string | null = null
    try {
      value = await source.read(key)
    } catch {
      skipped.push(key)
      continue
    }
    if (value === null) continue
    await target.setItemAsync(key, value)
    migrated += 1
  }

  return { migrated, skipped }
}

/** Builds the list of storage keys that hold wallet state for the given identities. */
export function walletRecordKeys(identityKeyIds: readonly string[]): string[] {
  return [KEYRING_INDEX_KEY, ...identityKeyIds]
}

export class HardwareProtectionUnsupportedError extends Error {
  constructor(details: string) {
    super(details)
    this.name = 'HardwareProtectionUnsupportedError'
  }
}

/**
 * Reports whether this device can bind wallet storage to a passkey.
 */
export async function probeHardwareProtection(deps: {
  credentialsContainer?: CredentialsContainer | undefined
}): Promise<{ available: boolean; reason: string }> {
  const capabilities = await checkWebAuthnPrfSupport({
    credentialsContainer: deps.credentialsContainer,
  })
  const available = capabilities.prfSupported && capabilities.platformAuthenticatorAvailable
  return {
    available,
    reason:
      capabilities.details ??
      (available ? 'Passkey hardware protection is available.' : 'Passkey PRF is unavailable.'),
  }
}

/** Creates a PRF provider for the given profile. Never falls back to software. */
export function createProvider(deps: HardwareProtectionDeps): WebAuthnPrfKeyProvider {
  return new WebAuthnPrfKeyProvider({
    profile: deps.profile,
    crypto: deps.crypto,
    rpId: deps.rpId,
  })
}

/** Builds a PRF-bound store from an already-unlocked provider. */
export function createBoundStore(
  deps: HardwareProtectionDeps,
  provider: WebAuthnPrfKeyProvider
): ISecureStore {
  return createHardwareBoundSecureStore(
    {
      profile: deps.profile,
      indexedDB: deps.indexedDB,
      crypto: deps.crypto,
    },
    provider
  )
}

/** The software-wrapped store used when hardware protection is not enabled. */
export function createSoftwareStore(deps: HardwareProtectionDeps): ISecureStore {
  return new IndexedDbSecureStore({
    profile: deps.profile,
    indexedDB: deps.indexedDB,
    crypto: deps.crypto,
  })
}

/**
 * Enables hardware protection: registers a passkey, unlocks the provider, and re-wraps
 * existing wallet records under the PRF-derived key.
 */
export async function enableHardwareProtection(
  deps: HardwareProtectionDeps,
  identityKeyIds: readonly string[]
): Promise<{ record: PrfPasskeyRecord; migrated: number; skipped: string[] }> {
  const probe = await probeHardwareProtection({
    credentialsContainer: deps.credentialsContainer,
  })
  if (!probe.available) {
    throw new HardwareProtectionUnsupportedError(probe.reason)
  }

  const provider = createProvider(deps)
  const record = await unlockPrfProvider(provider, {
    profile: deps.profile,
    credentialsContainer: deps.credentialsContainer,
    crypto: deps.crypto,
    rpId: deps.rpId,
  })

  const software = createSoftwareStore(deps)
  const bound = createBoundStore(deps, provider)
  const result = await migrateWalletRecords(
    {
      keys: walletRecordKeys(identityKeyIds),
      read: (key) => software.getItemAsync(key),
    },
    bound
  )

  await deps.writeState({ enabled: true, record })
  return { record, ...result }
}

/**
 * Unlocks an already-enabled hardware store for this session.
 *
 * @throws PrfUnavailableError when the user cancels or the authenticator is unavailable.
 */
export async function unlockHardwareProtection(
  deps: HardwareProtectionDeps
): Promise<{ provider: WebAuthnPrfKeyProvider; store: ISecureStore }> {
  const state = await deps.readState()
  if (!state.enabled || !state.record) {
    throw new PrfUnavailableError('Hardware protection is not enabled on this device.')
  }

  const provider = createProvider(deps)
  await unlockPrfProvider(provider, {
    profile: deps.profile,
    credentialsContainer: deps.credentialsContainer,
    crypto: deps.crypto,
    rpId: deps.rpId,
    record: state.record,
  })

  return { provider, store: createBoundStore(deps, provider) }
}
