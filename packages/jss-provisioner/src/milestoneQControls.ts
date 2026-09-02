export type MilestoneQFeature = 'directory' | 'peer-profile' | 'relationship' | 'transport'

export interface MilestoneQAvailability {
  directory: boolean
  peerProfile: boolean
  relationship: boolean
  transport: boolean
}

export interface MilestoneQControlsOptions {
  metricSink?: (metric: string, value: number) => void
  /** Features disabled at runtime for incident response. */
  disabledFeatures?: Iterable<MilestoneQFeature>
}

const ALL_FEATURES: MilestoneQFeature[] = [
  'directory',
  'peer-profile',
  'relationship',
  'transport',
]

/**
 * Milestone Q features are available to any authenticated WebID. There is no cohort
 * gating, but each feature retains a runtime kill-switch (`JSS_Q_DISABLED_FEATURES`) so a
 * vulnerability can be contained without a code change and redeploy. See NC-10.
 */
export class MilestoneQControls {
  private readonly counters = new Map<string, number>()
  private readonly metricSink: (metric: string, value: number) => void
  private readonly disabled: ReadonlySet<MilestoneQFeature>

  constructor(options: MilestoneQControlsOptions = {}) {
    this.metricSink = options.metricSink ?? defaultMetricSink
    this.disabled = new Set(options.disabledFeatures ?? [])
  }

  isEnabled(feature: MilestoneQFeature, webId?: string): boolean {
    if (this.disabled.has(feature)) return false
    return Boolean(webId)
  }

  isConfigured(feature: MilestoneQFeature): boolean {
    return !this.disabled.has(feature)
  }

  availability(webId: string): MilestoneQAvailability {
    return {
      directory: this.isEnabled('directory', webId),
      peerProfile: this.isEnabled('peer-profile', webId),
      relationship: this.isEnabled('relationship', webId),
      transport: this.isEnabled('transport', webId),
    }
  }

  count(feature: MilestoneQFeature, outcome: string): void {
    const key = `${feature}.${normalizeOutcome(outcome)}`
    const value = (this.counters.get(key) ?? 0) + 1
    this.counters.set(key, value)
    this.metricSink(key, value)
  }

  flags(): Record<MilestoneQFeature, boolean> {
    return {
      directory: !this.disabled.has('directory'),
      'peer-profile': !this.disabled.has('peer-profile'),
      relationship: !this.disabled.has('relationship'),
      transport: !this.disabled.has('transport'),
    }
  }
}

/** Parses `JSS_Q_DISABLED_FEATURES`; unknown names are ignored rather than failing startup. */
export function parseDisabledFeatures(raw: string | undefined): MilestoneQFeature[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is MilestoneQFeature =>
      (ALL_FEATURES as string[]).includes(entry)
    )
}

export function createMilestoneQControlsFromEnv(): MilestoneQControls {
  const disabledFeatures = parseDisabledFeatures(process.env.JSS_Q_DISABLED_FEATURES)
  if (disabledFeatures.length > 0) {
    console.warn(
      '[milestone-q] runtime kill-switch active for:',
      disabledFeatures.join(', ')
    )
  }
  return new MilestoneQControls({ metricSink: defaultMetricSink, disabledFeatures })
}

function normalizeOutcome(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
  return normalized || 'unknown'
}

function defaultMetricSink(metric: string, value: number): void {
  console.log('[milestone-q:metric]', JSON.stringify({ metric, value }))
}
