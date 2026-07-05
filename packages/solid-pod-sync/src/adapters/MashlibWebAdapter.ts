export interface MashlibPaneDescriptor {
  id: string
  label: string
}

export interface MashlibWebAdapter {
  readonly isSupported: boolean
  readonly reason?: string
  listPanes(resourceUrl: string): Promise<MashlibPaneDescriptor[]>
}

interface MashlibLikeModule {
  listPanes?: (resourceUrl: string) => MashlibPaneDescriptor[] | Promise<MashlibPaneDescriptor[]>
}

export interface MashlibWebAdapterOptions {
  runtimePlatform?: 'web' | 'native'
  loader?: () => Promise<MashlibLikeModule>
}

function unsupported(reason: string): MashlibWebAdapter {
  return {
    isSupported: false,
    reason,
    async listPanes(): Promise<MashlibPaneDescriptor[]> {
      return []
    },
  }
}

export function createMashlibWebAdapter(options: MashlibWebAdapterOptions = {}): MashlibWebAdapter {
  const runtimePlatform = options.runtimePlatform ?? 'native'

  if (runtimePlatform !== 'web') {
    return unsupported('Mashlib adapter is web-only by ADR-004 boundary.')
  }

  if (!options.loader) {
    return unsupported('Mashlib loader not configured.')
  }

  return {
    isSupported: true,
    async listPanes(resourceUrl: string): Promise<MashlibPaneDescriptor[]> {
      const module = await options.loader?.()
      if (!module?.listPanes) return []
      const panes = await module.listPanes(resourceUrl)
      return panes
    },
  }
}