import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { PrfUnavailableError } from '@nodezero/embedded-wallet'
import { adoptHardwareWalletStore } from '../contexts/WalletContext'
import {
  enableHardwareProtection,
  HardwareProtectionUnsupportedError,
  probeHardwareProtection,
  unlockHardwareProtection,
  type HardwareProtectionDeps,
} from './hardwareProtection'
import {
  clearHardwareProtectionState,
  readHardwareProtectionState,
  writeHardwareProtectionState,
} from './hardwareProtectionState'

export interface HardwareProtectionUi {
  available: boolean
  enabled: boolean
  unlocked: boolean
  busy: boolean
  status: string | null
  enable: (identityKeyIds: readonly string[]) => Promise<void>
  unlock: () => Promise<void>
  disable: () => Promise<void>
}

function deps(): HardwareProtectionDeps {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  return {
    profile: appExtra?.envProfile ?? 'local',
    readState: readHardwareProtectionState,
    writeState: writeHardwareProtectionState,
  }
}

function describe(error: unknown): string {
  if (error instanceof HardwareProtectionUnsupportedError) {
    return `Passkey protection is unavailable on this device: ${error.message}`
  }
  if (error instanceof PrfUnavailableError) return error.message
  return error instanceof Error ? error.message : 'Passkey protection failed.'
}

/**
 * Drives the opt-in passkey protection flow for the web wallet.
 *
 * Enabling re-wraps existing wallet records under a PRF-derived key; from then on the
 * wallet cannot be read without a user-verification gesture.
 */
export function useHardwareProtection(): HardwareProtectionUi {
  const [available, setAvailable] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (Platform.OS !== 'web') return
    void probeHardwareProtection({}).then((probe) => setAvailable(probe.available))
    void readHardwareProtectionState().then((state) => setEnabled(state.enabled))
  }, [])

  const enable = useCallback(async (identityKeyIds: readonly string[]): Promise<void> => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await enableHardwareProtection(deps(), identityKeyIds)
      setEnabled(true)
      setUnlocked(true)
      const skipped = result.skipped.length
      setStatus(
        `Passkey protection enabled. ${result.migrated} record(s) re-encrypted` +
          (skipped > 0 ? `; ${skipped} could not be read and were skipped.` : '.')
      )
    } catch (error) {
      setStatus(describe(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const unlock = useCallback(async (): Promise<void> => {
    setBusy(true)
    setStatus(null)
    try {
      const { store } = await unlockHardwareProtection(deps())
      adoptHardwareWalletStore(store)
      setUnlocked(true)
      setStatus('Wallet unlocked.')
    } catch (error) {
      setUnlocked(false)
      setStatus(describe(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const disable = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      // Only the flag is cleared. Records stay wrapped under the PRF key, so the user
      // must re-enable (and re-verify) to reach them; clearing here must not imply the
      // wallet reverted to software wrapping.
      await clearHardwareProtectionState()
      setEnabled(false)
      setUnlocked(false)
      setStatus('Passkey protection disabled for this device.')
    } finally {
      setBusy(false)
    }
  }, [])

  return { available, enabled, unlocked, busy, status, enable, unlock, disable }
}
