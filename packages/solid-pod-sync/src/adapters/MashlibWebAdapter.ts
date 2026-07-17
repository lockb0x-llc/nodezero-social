export interface MashlibPaneDescriptor {
  id: string
  label: string
}

export type MashlibResourceType = 'docustream' | 'profile' | 'social-graph' | 'generic'

export interface MashlibResourceBinding {
  resourceType: MashlibResourceType
  resourceUrl: string
  panes: MashlibPaneDescriptor[]
}

export interface MashlibWebAdapter {
  readonly isSupported: boolean
  readonly reason?: string
  inferResourceType(resourceUrl: string): MashlibResourceType
  listPanes(resourceUrl: string): Promise<MashlibPaneDescriptor[]>
  listBoundPanes(resourceUrl: string): Promise<MashlibResourceBinding>
}

interface MashlibLikeModule {
  listPanes?: (resourceUrl: string) => unknown[] | Promise<unknown[]>
}

export interface MashlibWebAdapterOptions {
  runtimePlatform?: 'web' | 'native'
  loader?: () => Promise<MashlibLikeModule>
}

function unsupported(reason: string): MashlibWebAdapter {
  return {
    isSupported: false,
    reason,
    inferResourceType(): MashlibResourceType {
      return 'generic'
    },
    listPanes(): Promise<MashlibPaneDescriptor[]> {
      return Promise.resolve([])
    },
    listBoundPanes(resourceUrl: string): Promise<MashlibResourceBinding> {
      return Promise.resolve({
        resourceType: 'generic',
        resourceUrl,
        panes: [],
      })
    },
  }
}

function humanizePaneId(id: string): string {
  const normalized = id.trim().replace(/[._-]+/g, ' ')
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}

function normalizePaneDescriptor(pane: unknown): MashlibPaneDescriptor | null {
  if (typeof pane === 'string') {
    const id = pane.trim().toLowerCase()
    if (!id) return null
    return {
      id,
      label: humanizePaneId(id),
    }
  }

  if (!pane || typeof pane !== 'object') return null

  const candidate = pane as Record<string, unknown>
  const idValue =
    typeof candidate.id === 'string'
      ? candidate.id
      : typeof candidate.name === 'string'
        ? candidate.name
        : null

  if (!idValue) return null
  const id = idValue.trim().toLowerCase()
  if (!id) return null

  const labelValue =
    typeof candidate.label === 'string'
      ? candidate.label
      : typeof candidate.title === 'string'
        ? candidate.title
        : humanizePaneId(id)

  return {
    id,
    label: labelValue,
  }
}

export function inferMashlibResourceType(resourceUrl: string): MashlibResourceType {
  const normalized = resourceUrl.toLowerCase()

  if (normalized.includes('/public/docustream/') || normalized.includes('/docustream/')) {
    return 'docustream'
  }

  if (normalized.includes('/profile/card') || normalized.includes('/profile/')) {
    return 'profile'
  }

  if (normalized.includes('/public/graph/') || normalized.includes('/social-graph/') || normalized.includes('/friends/')) {
    return 'social-graph'
  }

  return 'generic'
}

function defaultPaneIdsForResourceType(resourceType: MashlibResourceType): string[] {
  switch (resourceType) {
    case 'docustream':
      return ['activity', 'stream', 'timeline']
    case 'profile':
      return ['profile', 'contact', 'tripledoc']
    case 'social-graph':
      return ['social-graph', 'friends', 'network']
    case 'generic':
    default:
      return ['tripledoc']
  }
}

function dedupePanes(panes: MashlibPaneDescriptor[]): MashlibPaneDescriptor[] {
  const byId = new Map<string, MashlibPaneDescriptor>()
  for (const pane of panes) {
    byId.set(pane.id, pane)
  }
  return Array.from(byId.values())
}

export function createMashlibWebAdapter(options: MashlibWebAdapterOptions = {}): MashlibWebAdapter {
  const runtimePlatform = options.runtimePlatform ?? 'native'

  if (runtimePlatform !== 'web') {
    return unsupported('Mashlib adapter is web-only by ADR-004 boundary.')
  }

  if (!options.loader) {
    return unsupported('Mashlib loader not configured.')
  }

  let modulePromise: Promise<MashlibLikeModule> | null = null
  const loadModule = async (): Promise<MashlibLikeModule> => {
    modulePromise ??= options.loader?.() ?? Promise.resolve({})
    return modulePromise
  }

  return {
    isSupported: true,
    inferResourceType(resourceUrl: string): MashlibResourceType {
      return inferMashlibResourceType(resourceUrl)
    },
    async listPanes(resourceUrl: string): Promise<MashlibPaneDescriptor[]> {
      const module = await loadModule()
      if (!module?.listPanes) return []
      const panes = await module.listPanes(resourceUrl)
      return panes
        .map(normalizePaneDescriptor)
        .filter((pane): pane is MashlibPaneDescriptor => pane !== null)
    },
    async listBoundPanes(resourceUrl: string): Promise<MashlibResourceBinding> {
      const resourceType = inferMashlibResourceType(resourceUrl)
      const inferredDefaults = defaultPaneIdsForResourceType(resourceType).map((id) => ({
        id,
        label: humanizePaneId(id),
      }))
      const modulePanes = await this.listPanes(resourceUrl)

      return {
        resourceType,
        resourceUrl,
        panes: dedupePanes([...inferredDefaults, ...modulePanes]),
      }
    },
  }
}