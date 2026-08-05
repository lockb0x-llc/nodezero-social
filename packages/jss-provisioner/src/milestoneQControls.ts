import { createHmac } from 'node:crypto'

export type MilestoneQFeature = 'directory' | 'peer-profile' | 'relationship' | 'transport'

export interface MilestoneQAvailability {
  directory: boolean
  peerProfile: boolean
  relationship: boolean
  transport: boolean
}

export interface MilestoneQControlsOptions {
  directoryEnabled?: boolean
  peerProfileEnabled?: boolean
  transportEnabled?: boolean
  relationshipEnabled?: boolean
  cohortHashes?: string[]
  cohortKey?: string
  metricSink?: (metric: string, value: number) => void
}

export class MilestoneQControls {
  private readonly enabled: Record<MilestoneQFeature, boolean>
  private readonly cohortHashes: Set<string>
  private readonly cohortKey: string
  private readonly counters = new Map<string, number>()
  private readonly metricSink: (metric: string, value: number) => void

  constructor(options: MilestoneQControlsOptions = {}) {
    this.enabled = {
      directory: options.directoryEnabled ?? false,
      'peer-profile': options.peerProfileEnabled ?? false,
      relationship: options.relationshipEnabled ?? false,
      transport: options.transportEnabled ?? false,
    }
    this.cohortHashes = new Set(
      (options.cohortHashes ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)
    )
    this.cohortKey = options.cohortKey?.trim() ?? ''
    this.metricSink = options.metricSink ?? defaultMetricSink
  }

  isEnabled(feature: MilestoneQFeature, webId?: string): boolean {
    if (!this.isConfigured(feature) || !webId) return false
    return this.cohortHashes.has(hashCohortIdentity(webId, this.cohortKey))
  }

  isConfigured(feature: MilestoneQFeature): boolean {
    return this.enabled[feature] && this.cohortHashes.size > 0 && Boolean(this.cohortKey)
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
    return { ...this.enabled }
  }
}

export function createMilestoneQControlsFromEnv(): MilestoneQControls {
  return new MilestoneQControls({
    directoryEnabled: enabled(process.env.JSS_Q_DIRECTORY_ENABLED),
    peerProfileEnabled: enabled(process.env.JSS_Q_PEER_PROFILE_ENABLED),
    relationshipEnabled: enabled(process.env.JSS_Q_RELATIONSHIP_ENABLED),
    transportEnabled: enabled(process.env.JSS_Q_TRANSPORT_ENABLED),
    cohortHashes: (process.env.JSS_Q_COHORT_HASHES ?? '').split(','),
    ...(process.env.JSS_Q_COHORT_KEY ? { cohortKey: process.env.JSS_Q_COHORT_KEY } : {}),
    metricSink: defaultMetricSink,
  })
}

export function hashCohortIdentity(webId: string, cohortKey: string): string {
  if (!cohortKey.trim()) throw new Error('Milestone Q cohort key is required.')
  return createHmac('sha256', cohortKey).update(webId.trim()).digest('hex')
}

function enabled(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test((value ?? '').trim())
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
