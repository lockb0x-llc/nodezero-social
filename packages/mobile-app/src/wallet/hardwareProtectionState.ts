import AsyncStorage from '@react-native-async-storage/async-storage'
import type { HardwareProtectionState } from './hardwareProtection'

const STORAGE_KEY = 'nodezero.wallet.hardware-protection.v1'

export interface KeyValueStorage {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

const DISABLED: HardwareProtectionState = { enabled: false, record: null }

function defaultStorage(): KeyValueStorage {
  return AsyncStorage as unknown as KeyValueStorage
}

/**
 * Persists whether this device has bound wallet storage to a passkey, and which
 * credential holds the PRF secret. The credential id is not sensitive: it is useless
 * without the authenticator and a user-verification gesture.
 */
export async function readHardwareProtectionState(
  storage: KeyValueStorage = defaultStorage()
): Promise<HardwareProtectionState> {
  try {
    const raw = await storage.getItem(STORAGE_KEY)
    if (!raw) return DISABLED
    const parsed = JSON.parse(raw) as HardwareProtectionState
    if (typeof parsed?.enabled !== 'boolean') return DISABLED
    // An enabled flag without a credential cannot be unlocked; never claim protection.
    if (parsed.enabled && typeof parsed.record?.credentialId !== 'string') return DISABLED
    return { enabled: parsed.enabled, record: parsed.record ?? null }
  } catch {
    return DISABLED
  }
}

export async function writeHardwareProtectionState(
  state: HardwareProtectionState,
  storage: KeyValueStorage = defaultStorage()
): Promise<void> {
  await storage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export async function clearHardwareProtectionState(
  storage: KeyValueStorage = defaultStorage()
): Promise<void> {
  await storage.removeItem(STORAGE_KEY)
}
