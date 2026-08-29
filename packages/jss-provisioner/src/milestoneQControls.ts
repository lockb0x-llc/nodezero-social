export type MilestoneQFeature = 'directory' | 'peer-profile' | 'relationship' | 'transport'

export interface MilestoneQAvailability {
  directory: boolean
  peerProfile: boolean
  relationship: boolean
  transport: boolean
}

export interface MilestoneQControlsOptions {
  metricSink?: (metric: string, value: number) => void
}

/**
 * All Milestone Q features are always available to any authenticated WebID
 * on staging-testnet. There is no cohort/rollout gating layer; this class
 * only retains per-feature telemetry counters.
 */
export class MilestoneQControls {
  private readonly counters = new Map<string, number>()
  private readonly metricSink: (metric: string, value: number) => void

  constructor(options: MilestoneQControlsOptions = {}) {
    this.metricSink = options.metricSink ?? defaultMetricSink
  }

  isEnabled(_feature: MilestoneQFeature, webId?: string): boolean {
    return Boolean(webId)
  }

  isConfigured(_feature: MilestoneQFeature): boolean {
    return true
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
    return { directory: true, 'peer-profile': true, relationship: true, transport: true }
  }
}

export function createMilestoneQControlsFromEnv(): MilestoneQControls {
  return new MilestoneQControls({ metricSink: defaultMetricSink })
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
