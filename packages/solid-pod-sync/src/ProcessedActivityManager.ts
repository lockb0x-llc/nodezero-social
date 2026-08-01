import {
  buildThing,
  createSolidDataset,
  createThing,
  getInteger,
  getSolidDataset,
  getStringNoLocale,
  getThing,
  getUrl,
  removeThing,
  saveSolidDatasetAt,
  setThing,
  type SolidDataset,
  type Thing,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'
import {
  assertValidProcessedActivityRecord,
  type ProcessedActivityRecord,
} from './contracts/ConsentfulDiscoveryContract.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface ProcessedActivityManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
  }
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const NZ_PROCESSED_ACTIVITY = 'https://nodezero.social/ns#ProcessedActivity'
const NZ_VERSION = 'https://nodezero.social/ns#version'
const NZ_ACTIVITY_ID = 'https://nodezero.social/ns#activityId'
const NZ_ACTOR_WEB_ID = 'https://nodezero.social/ns#actorWebId'
const NZ_PROCESSED_AT = 'https://nodezero.social/ns#processedAt'
const NZ_EXPIRES_AT = 'https://nodezero.social/ns#expiresAt'

function ledgerUrl(podRoot: string): string {
  return `${podRoot.replace(/\/$/, '')}/social/processed-activities/index`
}

function activityThingUrl(podRoot: string, activityId: string): string {
  return `${ledgerUrl(podRoot)}#activity-${encodeURIComponent(activityId)}`
}

export class ProcessedActivityManager {
  constructor(
    private readonly session: AuthenticatedSession,
    private readonly options: ProcessedActivityManagerOptions = {}
  ) {}

  async getProcessedActivity(
    podRoot: string,
    activityId: string
  ): Promise<ProcessedActivityRecord | null> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return null
    const thing = getThing(dataset, activityThingUrl(podRoot, activityId))
    if (!thing) return null
    const record = thingToProcessedActivity(thing)
    assertValidProcessedActivityRecord(record)
    return record
  }

  async hasProcessedActivity(
    podRoot: string,
    activityId: string,
    now = new Date()
  ): Promise<boolean> {
    const record = await this.getProcessedActivity(podRoot, activityId)
    return record !== null && Date.parse(record.expiresAt) > now.getTime()
  }

  async recordProcessedActivity(
    podRoot: string,
    record: ProcessedActivityRecord
  ): Promise<ProcessedActivityRecord> {
    await this.ensurePodLayoutIfEnabled(podRoot)
    assertValidProcessedActivityRecord(record)
    const datasetUrl = ledgerUrl(podRoot)
    const thingUrl = activityThingUrl(podRoot, record.activityId)
    const dataset = (await this.readDataset(podRoot)) ?? createSolidDataset()
    const existing = getThing(dataset, thingUrl) ?? createThing({ url: thingUrl })
    const thing = buildThing(existing)
      .removeAll(RDF_TYPE)
      .removeAll(NZ_VERSION)
      .removeAll(NZ_ACTIVITY_ID)
      .removeAll(NZ_ACTOR_WEB_ID)
      .removeAll(NZ_PROCESSED_AT)
      .removeAll(NZ_EXPIRES_AT)
      .setUrl(RDF_TYPE, NZ_PROCESSED_ACTIVITY)
      .setInteger(NZ_VERSION, record.version)
      .setUrl(NZ_ACTIVITY_ID, record.activityId)
      .setUrl(NZ_ACTOR_WEB_ID, record.actorWebId)
      .setStringNoLocale(NZ_PROCESSED_AT, record.processedAt)
      .setStringNoLocale(NZ_EXPIRES_AT, record.expiresAt)
      .build()
    await saveSolidDatasetAt(datasetUrl, setThing(dataset, thing), { fetch: this.session.fetch })
    return record
  }

  async removeProcessedActivity(podRoot: string, activityId: string): Promise<void> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return
    const thingUrl = activityThingUrl(podRoot, activityId)
    if (!getThing(dataset, thingUrl)) return
    await saveSolidDatasetAt(ledgerUrl(podRoot), removeThing(dataset, thingUrl), {
      fetch: this.session.fetch,
    })
  }

  private async readDataset(
    podRoot: string
  ): Promise<(SolidDataset & Partial<WithServerResourceInfo>) | null> {
    try {
      return await getSolidDataset(ledgerUrl(podRoot), { fetch: this.session.fetch })
    } catch (error) {
      if (isNotFoundError(error)) return null
      throw error
    }
  }

  private async ensurePodLayoutIfEnabled(podRoot: string): Promise<void> {
    if (!this.options.enablePodBootstrap) return
    const manager =
      this.options.podLayoutManager ?? new PodLayoutManager({ fetch: this.session.fetch })
    await manager.ensureDefaultLayoutAndPolicies(
      podRoot,
      this.options.policyMatrix ?? DEFAULT_POLICY_MATRIX
    )
  }
}

function thingToProcessedActivity(thing: Thing): ProcessedActivityRecord {
  return {
    version: getInteger(thing, NZ_VERSION) as 1,
    activityId: getUrl(thing, NZ_ACTIVITY_ID) ?? '',
    actorWebId: getUrl(thing, NZ_ACTOR_WEB_ID) ?? '',
    processedAt: getStringNoLocale(thing, NZ_PROCESSED_AT) ?? '',
    expiresAt: getStringNoLocale(thing, NZ_EXPIRES_AT) ?? '',
  }
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } }
  return candidate.statusCode === 404 || candidate.status === 404 || candidate.response?.status === 404
}

export const PROCESSED_ACTIVITIES_DATASET_PATH = 'social/processed-activities/index'
