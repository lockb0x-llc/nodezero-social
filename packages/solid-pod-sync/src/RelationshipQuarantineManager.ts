import {
  buildThing,
  createSolidDataset,
  createThing,
  getInteger,
  getSolidDataset,
  getStringNoLocale,
  getThing,
  getThingAll,
  getUrl,
  saveSolidDatasetAt,
  setThing,
  type SolidDataset,
  type Thing,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface RelationshipQuarantineManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
  }
  maxPayloadBytes?: number
}

export interface QuarantinedRelationshipActivity {
  version: 1
  quarantineId: string
  receivedAt: string
  reasonCode: string
  payloadJson: string
  activityId?: string
  claimedActorWebId?: string
  sourceUrl?: string
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const NZ_QUARANTINED_ACTIVITY = 'https://nodezero.social/ns#QuarantinedRelationshipActivity'
const NZ_VERSION = 'https://nodezero.social/ns#version'
const NZ_QUARANTINE_ID = 'https://nodezero.social/ns#quarantineId'
const NZ_RECEIVED_AT = 'https://nodezero.social/ns#receivedAt'
const NZ_REASON_CODE = 'https://nodezero.social/ns#reasonCode'
const NZ_PAYLOAD_JSON = 'https://nodezero.social/ns#payloadJson'
const NZ_ACTIVITY_ID = 'https://nodezero.social/ns#activityId'
const NZ_CLAIMED_ACTOR = 'https://nodezero.social/ns#claimedActorWebId'
const NZ_SOURCE_URL = 'https://nodezero.social/ns#sourceUrl'
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024

function quarantineUrl(podRoot: string): string {
  return `${podRoot.replace(/\/$/, '')}/social/quarantine/index`
}

function quarantineThingUrl(podRoot: string, quarantineId: string): string {
  return `${quarantineUrl(podRoot)}#entry-${encodeURIComponent(quarantineId)}`
}

export class RelationshipQuarantineManager {
  private readonly maxPayloadBytes: number

  constructor(
    private readonly session: AuthenticatedSession,
    private readonly options: RelationshipQuarantineManagerOptions = {}
  ) {
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES
  }

  async listQuarantinedActivities(podRoot: string): Promise<QuarantinedRelationshipActivity[]> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return []
    return getThingAll(dataset)
      .filter((thing) => getUrl(thing, RDF_TYPE) === NZ_QUARANTINED_ACTIVITY)
      .map(thingToRecord)
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
  }

  async getQuarantinedActivity(
    podRoot: string,
    quarantineId: string
  ): Promise<QuarantinedRelationshipActivity | null> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return null
    const thing = getThing(dataset, quarantineThingUrl(podRoot, quarantineId))
    return thing ? thingToRecord(thing) : null
  }

  async quarantine(
    podRoot: string,
    record: QuarantinedRelationshipActivity
  ): Promise<QuarantinedRelationshipActivity> {
    validateRecord(record, this.maxPayloadBytes)
    await this.ensurePodLayoutIfEnabled(podRoot)
    const datasetUrl = quarantineUrl(podRoot)
    const thingUrl = quarantineThingUrl(podRoot, record.quarantineId)
    const dataset = (await this.readDataset(podRoot)) ?? createSolidDataset()
    const existing = getThing(dataset, thingUrl) ?? createThing({ url: thingUrl })
    let builder = buildThing(existing)
      .removeAll(RDF_TYPE)
      .removeAll(NZ_VERSION)
      .removeAll(NZ_QUARANTINE_ID)
      .removeAll(NZ_RECEIVED_AT)
      .removeAll(NZ_REASON_CODE)
      .removeAll(NZ_PAYLOAD_JSON)
      .removeAll(NZ_ACTIVITY_ID)
      .removeAll(NZ_CLAIMED_ACTOR)
      .removeAll(NZ_SOURCE_URL)
      .setUrl(RDF_TYPE, NZ_QUARANTINED_ACTIVITY)
      .setInteger(NZ_VERSION, record.version)
      .setStringNoLocale(NZ_QUARANTINE_ID, record.quarantineId)
      .setStringNoLocale(NZ_RECEIVED_AT, record.receivedAt)
      .setStringNoLocale(NZ_REASON_CODE, record.reasonCode)
      .setStringNoLocale(NZ_PAYLOAD_JSON, record.payloadJson)
    if (record.activityId) builder = builder.setUrl(NZ_ACTIVITY_ID, record.activityId)
    if (record.claimedActorWebId) builder = builder.setUrl(NZ_CLAIMED_ACTOR, record.claimedActorWebId)
    if (record.sourceUrl) builder = builder.setUrl(NZ_SOURCE_URL, record.sourceUrl)
    await saveSolidDatasetAt(datasetUrl, setThing(dataset, builder.build()), {
      fetch: this.session.fetch,
    })
    return record
  }

  private async readDataset(
    podRoot: string
  ): Promise<(SolidDataset & Partial<WithServerResourceInfo>) | null> {
    try {
      return await getSolidDataset(quarantineUrl(podRoot), { fetch: this.session.fetch })
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

function validateRecord(record: QuarantinedRelationshipActivity, maxPayloadBytes: number): void {
  if (record.version !== 1) throw new Error('Quarantine record version must be 1.')
  if (!record.quarantineId.trim()) throw new Error('Quarantine ID cannot be blank.')
  if (!record.reasonCode.trim()) throw new Error('Quarantine reason cannot be blank.')
  if (!Number.isFinite(Date.parse(record.receivedAt))) throw new Error('receivedAt must be a timestamp.')
  if (new TextEncoder().encode(record.payloadJson).byteLength > maxPayloadBytes) {
    throw new Error(`Quarantine payload exceeds ${maxPayloadBytes} bytes.`)
  }
  JSON.parse(record.payloadJson)
  for (const value of [record.activityId, record.claimedActorWebId, record.sourceUrl]) {
    if (value !== undefined && new URL(value).protocol !== 'https:') {
      throw new Error('Quarantine URLs must use https.')
    }
  }
}

function thingToRecord(thing: Thing): QuarantinedRelationshipActivity {
  const record: QuarantinedRelationshipActivity = {
    version: getInteger(thing, NZ_VERSION) as 1,
    quarantineId: getStringNoLocale(thing, NZ_QUARANTINE_ID) ?? '',
    receivedAt: getStringNoLocale(thing, NZ_RECEIVED_AT) ?? '',
    reasonCode: getStringNoLocale(thing, NZ_REASON_CODE) ?? '',
    payloadJson: getStringNoLocale(thing, NZ_PAYLOAD_JSON) ?? '',
  }
  const activityId = getUrl(thing, NZ_ACTIVITY_ID)
  const claimedActorWebId = getUrl(thing, NZ_CLAIMED_ACTOR)
  const sourceUrl = getUrl(thing, NZ_SOURCE_URL)
  if (activityId) record.activityId = activityId
  if (claimedActorWebId) record.claimedActorWebId = claimedActorWebId
  if (sourceUrl) record.sourceUrl = sourceUrl
  validateRecord(record, DEFAULT_MAX_PAYLOAD_BYTES)
  return record
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } }
  return candidate.statusCode === 404 || candidate.status === 404 || candidate.response?.status === 404
}

export const RELATIONSHIP_QUARANTINE_DATASET_PATH = 'social/quarantine/index'
