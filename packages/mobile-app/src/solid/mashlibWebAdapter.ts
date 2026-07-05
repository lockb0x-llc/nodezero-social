import Constants from 'expo-constants'
import { Platform } from 'react-native'
import {
  createMashlibWebAdapter,
  type MashlibWebAdapter,
} from '@nodezero/solid-pod-sync'

type MashlibLikeModule = {
  listPanes?: (resourceUrl: string) => unknown[] | Promise<unknown[]>
}

function isMashlibExplorerEnabled(): boolean {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  const raw = (appExtra?.mashlibExplorerEnabled ?? 'false').toLowerCase().trim()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

let cachedAdapter: MashlibWebAdapter | null = null

export function getMashlibWebAdapter(): MashlibWebAdapter {
  if (cachedAdapter) return cachedAdapter

  const runtimePlatform = Platform.OS === 'web' ? 'web' : 'native'
  if (!isMashlibExplorerEnabled()) {
    cachedAdapter = createMashlibWebAdapter({ runtimePlatform })
    return cachedAdapter
  }

  cachedAdapter = createMashlibWebAdapter({
    runtimePlatform,
    loader: async (): Promise<MashlibLikeModule> => {
      const maybeModule = (globalThis as unknown as Record<string, unknown>).__NZ_MASHLIB__
      if (maybeModule && typeof maybeModule === 'object') {
        return maybeModule as MashlibLikeModule
      }
      return {}
    },
  })

  return cachedAdapter
}