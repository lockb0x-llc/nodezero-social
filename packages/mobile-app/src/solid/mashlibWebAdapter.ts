import Constants from 'expo-constants'
import { Platform } from 'react-native'
import {
  createMashlibWebAdapter,
  type MashlibWebAdapter,
} from '@nodezero/solid-pod-sync'

type MashlibLikeModule = {
  listPanes?: (resourceUrl: string) => unknown[] | Promise<unknown[]>
}

type DynamicImport = (moduleId: string) => Promise<unknown>

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
  const dynamicImport = new Function('id', 'return import(id)') as DynamicImport
  return dynamicImport(moduleId)
}

async function resolveMashlibRuntimeModule(): Promise<MashlibLikeModule> {
  const root = globalThis as unknown as Record<string, unknown>

  // 1) Explicit NodeZero runtime bridge injected by hosting shell.
  const nodeZeroBridge = normalizePaneListProvider(root.__NZ_MASHLIB__)
  if (nodeZeroBridge) return nodeZeroBridge

  // 2) Common mashlib globals (e.g., panes registry on window/global).
  const mashlibGlobal = normalizePaneListProvider(root.mashlib)
  if (mashlibGlobal) return mashlibGlobal
  const panesGlobal = normalizePaneListProvider({ panes: root.panes })
  if (panesGlobal) return panesGlobal

  // 3) Optional dynamic ESM runtime module load.
  const moduleId = mashlibModuleId()
  if (!moduleId) return {}

  try {
    const imported = await loadModuleById(moduleId)
    const direct = normalizePaneListProvider(imported)
    if (direct) return direct

    const withDefault = normalizePaneListProvider((imported as Record<string, unknown>)?.default)
    if (withDefault) return withDefault
  } catch {
    return {}
  }

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