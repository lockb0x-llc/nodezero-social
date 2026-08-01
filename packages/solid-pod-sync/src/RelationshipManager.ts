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
  removeThing,
  saveSolidDatasetAt,
  setThing,
  type SolidDataset,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'
import {
  assertValidRelationshipRecord,
  canTransitionRelationship,
  type RelationshipRecord,
  type RelationshipState,
} from './contracts/ConsentfulDiscoveryContract.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  deriveOwnerWebId,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface RelationshipManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
  }
}

export interface RelationshipTransitionInput {
  peerWebId: string
  to: RelationshipState
  updatedAt?: string
  activityId?: string
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const NZ_RELATIONSHIP = 'https://nodezero.social/ns#Relationship'
const NZ_VERSION = 'https://nodezero.social/ns#version'
const NZ_OWNER_WEB_ID = 'https://nodezero.social/ns#ownerWebId'
const NZ_PEER_WEB_ID = 'https://nodezero.social/ns#peerWebId'
const NZ_RELATIONSHIP_STATE = 'https://nodezero.social/ns#relationshipState'
const NZ_UPDATED_AT = 'https://nodezero.social/ns#updatedAt'
const NZ_ACTIVITY_ID = 'https://nodezero.social/ns#activityId'

const OWNED_PREDICATES = [
  RDF_TYPE,
  NZ_VERSION,
  NZ_OWNER_WEB_ID,
  NZ_PEER_WEB_ID,
  NZ_RELATIONSHIP_STATE,
  NZ_UPDATED_AT,
  NZ_ACTIVITY_ID,
] as const

function relationshipsUrl(podRoot: string): string {
  return `${podRoot.replace(/\/$/, '')}/social/relationships/index`
}

function relationshipThingUrl(podRoot: string, peerWebId: string): string {
  return `${relationshipsUrl(podRoot)}#peer-${encodeURIComponent(peerWebId)}`
}

export class RelationshipManager {
  constructor(
    private readonly session: AuthenticatedSession,
    private readonly options: RelationshipManagerOptions = {}
  ) {}

  async listRelationships(podRoot: string): Promise<RelationshipRecord[]> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return []

    const records: RelationshipRecord[] = []
    for (const thing of getThingAll(dataset)) {
      if (getUrl(thing, RDF_TYPE) !== NZ_RELATIONSHIP) continue
      const record = thingToRelationship(thing)
      assertValidRelationshipRecord(record)
      records.push(record)
    }

    return records.sort((left, right) => left.peerWebId.localeCompare(right.peerWebId))
  }

  async getRelationship(podRoot: string, peerWebId: string): Promise<RelationshipRecord | null> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return null
    const thing = getThing(dataset, relationshipThingUrl(podRoot, peerWebId))
    if (!thing) return null
    const record = thingToRelationship(thing)
    assertValidRelationshipRecord(record)
    return record
  }

  async transitionRelationship(
    podRoot: string,
    input: RelationshipTransitionInput
  ): Promise<RelationshipRecord> {
    await this.ensurePodLayoutIfEnabled(podRoot)

    const ownerWebId = deriveOwnerWebId(`${podRoot.replace(/\/$/, '')}/social/relationships/`)
    const existing = await this.getRelationship(podRoot, input.peerWebId)
    const from = existing?.state ?? 'none'
    if (!canTransitionRelationship(from, input.to)) {
      throw new Error(`Invalid relationship transition: ${from} -> ${input.to}`)
    }

    const record: RelationshipRecord = {
      version: 1,
      ownerWebId,
      peerWebId: input.peerWebId,
      state: input.to,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    }
    if (input.activityId !== undefined) record.activityId = input.activityId
    assertValidRelationshipRecord(record)
    await this.writeRecord(podRoot, record)
    return record
  }

  async importLegacyConnection(
    podRoot: string,
    peerWebId: string,
    updatedAt = new Date().toISOString()
  ): Promise<RelationshipRecord> {
    const existing = await this.getRelationship(podRoot, peerWebId)
    if (existing) return existing
    return this.transitionRelationship(podRoot, {
      peerWebId,
      to: 'legacy-connected',
      updatedAt,
    })
  }

  async removeRelationship(podRoot: string, peerWebId: string): Promise<void> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return
    const thingUrl = relationshipThingUrl(podRoot, peerWebId)
    if (!getThing(dataset, thingUrl)) return
    const updated = removeThing(dataset, thingUrl)
    await saveSolidDatasetAt(relationshipsUrl(podRoot), updated, { fetch: this.session.fetch })
  }

  private async writeRecord(podRoot: string, record: RelationshipRecord): Promise<void> {
    const datasetUrl = relationshipsUrl(podRoot)
    const thingUrl = relationshipThingUrl(podRoot, record.peerWebId)
    const dataset = (await this.readDataset(podRoot)) ?? createSolidDataset()
    const existing = getThing(dataset, thingUrl) ?? createThing({ url: thingUrl })
    let builder = buildThing(existing)
    for (const predicate of OWNED_PREDICATES) builder = builder.removeAll(predicate)

    builder = builder
      .setUrl(RDF_TYPE, NZ_RELATIONSHIP)
      .setInteger(NZ_VERSION, record.version)
      .setUrl(NZ_OWNER_WEB_ID, record.ownerWebId)
      .setUrl(NZ_PEER_WEB_ID, record.peerWebId)
      .setStringNoLocale(NZ_RELATIONSHIP_STATE, record.state)
      .setStringNoLocale(NZ_UPDATED_AT, record.updatedAt)
    if (record.activityId) builder = builder.setUrl(NZ_ACTIVITY_ID, record.activityId)

    await saveSolidDatasetAt(datasetUrl, setThing(dataset, builder.build()), {
      fetch: this.session.fetch,
    })
  }

  private async readDataset(
    podRoot: string
  ): Promise<(SolidDataset & Partial<WithServerResourceInfo>) | null> {
    try {
      return await getSolidDataset(relationshipsUrl(podRoot), { fetch: this.session.fetch })
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

function thingToRelationship(thing: Parameters<typeof getInteger>[0]): RelationshipRecord {
  const state = getStringNoLocale(thing, NZ_RELATIONSHIP_STATE) as RelationshipState | null
  const record: RelationshipRecord = {
    version: getInteger(thing, NZ_VERSION) as 1,
    ownerWebId: getUrl(thing, NZ_OWNER_WEB_ID) ?? '',
    peerWebId: getUrl(thing, NZ_PEER_WEB_ID) ?? '',
    state: state ?? ('none' as RelationshipState),
    updatedAt: getStringNoLocale(thing, NZ_UPDATED_AT) ?? '',
  }
  const activityId = getUrl(thing, NZ_ACTIVITY_ID)
  if (activityId !== null) record.activityId = activityId
  return record
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } }
  return candidate.statusCode === 404 || candidate.status === 404 || candidate.response?.status === 404
}

export const RELATIONSHIPS_DATASET_PATH = 'social/relationships/index'
