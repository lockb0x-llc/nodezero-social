import Constants from 'expo-constants'
import { Platform } from 'react-native'
import {
  createMashlibWebAdapter,
  type MashlibWebAdapter,
} from '@nodezero/solid-pod-sync'
import * as mashlibPaneProvider from './mashlibPaneProvider'

type MashlibLikeModule = {
  listPanes?: (resourceUrl: string) => unknown[] | Promise<unknown[]>
}

function mashlibModuleId(): string {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  return (appExtra?.mashlibModuleId ?? '').trim()
}

function normalizePaneListProvider(candidate: unknown): MashlibLikeModule | null {
  if (!candidate || typeof candidate !== 'object') return null
  const record = candidate as Record<string, unknown>

  if (typeof record.listPanes === 'function') {
    return { listPanes: record.listPanes as MashlibLikeModule['listPanes'] }
  }

  const panes = record.panes
  if (panes && typeof panes === 'object') {
    const paneIds = Object.keys(panes as Record<string, unknown>)
    return {
      listPanes: () => paneIds,
    }
  }

  return null
}

async function loadModuleById(moduleId: string): Promise<unknown> {
  // Hide from Metro bundler by using a Function constructor
  const dynamicImport = new Function('modulePath', 'return import(modulePath)')
  return dynamicImport(moduleId)
}

async function resolveMashlibRuntimeModule(): Promise<MashlibLikeModule> {
  const root = globalThis as unknown as Record<string, unknown>

  // 1) Module-id path (preferred) for explicit runtime provider selection.
  const moduleId = mashlibModuleId()
  if (moduleId) {
    if (moduleId === 'nodezero:mashlib-pane-provider') {
      return {
        listPanes: mashlibPaneProvider.listPanes,
      }
    }

    try {
      const imported = await loadModuleById(moduleId)
      const direct = normalizePaneListProvider(imported)
      if (direct) return direct

      const withDefault = normalizePaneListProvider((imported as Record<string, unknown>)?.default)
      if (withDefault) return withDefault
    } catch {
      // Continue to fallback runtime bridges below.
    }
  }

  // 2) Explicit NodeZero runtime bridge injected by hosting shell.
  const nodeZeroBridge = normalizePaneListProvider(root.__NZ_MASHLIB__)
  if (nodeZeroBridge) return nodeZeroBridge

  // 3) Common mashlib globals (e.g., panes registry on window/global).
  const mashlibGlobal = normalizePaneListProvider(root.mashlib)
  if (mashlibGlobal) return mashlibGlobal
  const panesGlobal = normalizePaneListProvider({ panes: root.panes })
  if (panesGlobal) return panesGlobal

  return {}
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
      return resolveMashlibRuntimeModule()
    },
  })

  return cachedAdapter
}