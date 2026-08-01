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
  type Thing,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'
import {
  assertValidModerationRecord,
  type ModerationAction,
  type ModerationRecord,
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

export interface ModerationManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
  }
}

export interface SetModerationInput {
  subjectWebId: string
  action: ModerationAction
  createdAt?: string
  reasonCode?: string
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const NZ_MODERATION_RECORD = 'https://nodezero.social/ns#ModerationRecord'
const NZ_VERSION = 'https://nodezero.social/ns#version'
const NZ_OWNER_WEB_ID = 'https://nodezero.social/ns#ownerWebId'
const NZ_SUBJECT_WEB_ID = 'https://nodezero.social/ns#subjectWebId'
const NZ_MODERATION_ACTION = 'https://nodezero.social/ns#moderationAction'
const NZ_CREATED_AT = 'https://nodezero.social/ns#createdAt'
const NZ_REASON_CODE = 'https://nodezero.social/ns#reasonCode'

const OWNED_PREDICATES = [
  RDF_TYPE,
  NZ_VERSION,
  NZ_OWNER_WEB_ID,
  NZ_SUBJECT_WEB_ID,
  NZ_MODERATION_ACTION,
  NZ_CREATED_AT,
  NZ_REASON_CODE,
] as const

function moderationUrl(podRoot: string): string {
  return `${podRoot.replace(/\/$/, '')}/social/moderation/index`
}

function moderationThingUrl(
  podRoot: string,
  subjectWebId: string,
  action: ModerationAction
): string {
  return `${moderationUrl(podRoot)}#${action}-${encodeURIComponent(subjectWebId)}`
}

export class ModerationManager {
  constructor(
    private readonly session: AuthenticatedSession,
    private readonly options: ModerationManagerOptions = {}
  ) {}

  async listModeration(podRoot: string): Promise<ModerationRecord[]> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return []
    const records: ModerationRecord[] = []
    for (const thing of getThingAll(dataset)) {
      if (getUrl(thing, RDF_TYPE) !== NZ_MODERATION_RECORD) continue
      const record = thingToModerationRecord(thing)
      assertValidModerationRecord(record)
      records.push(record)
    }
    return records.sort((left, right) => {
      const subjectOrder = left.subjectWebId.localeCompare(right.subjectWebId)
      return subjectOrder !== 0 ? subjectOrder : left.action.localeCompare(right.action)
    })
  }

  async setModeration(podRoot: string, input: SetModerationInput): Promise<ModerationRecord> {
    await this.ensurePodLayoutIfEnabled(podRoot)
    const ownerWebId = deriveOwnerWebId(`${podRoot.replace(/\/$/, '')}/social/moderation/`)
    const record: ModerationRecord = {
      version: 1,
      ownerWebId,
      subjectWebId: input.subjectWebId,
      action: input.action,
      createdAt: input.createdAt ?? new Date().toISOString(),
    }
    if (input.reasonCode !== undefined) record.reasonCode = input.reasonCode
    assertValidModerationRecord(record)

    const datasetUrl = moderationUrl(podRoot)
    const thingUrl = moderationThingUrl(podRoot, input.subjectWebId, input.action)
    const dataset = (await this.readDataset(podRoot)) ?? createSolidDataset()
    const existing = getThing(dataset, thingUrl) ?? createThing({ url: thingUrl })
    let builder = buildThing(existing)
    for (const predicate of OWNED_PREDICATES) builder = builder.removeAll(predicate)

    builder = builder
      .setUrl(RDF_TYPE, NZ_MODERATION_RECORD)
      .setInteger(NZ_VERSION, record.version)
      .setUrl(NZ_OWNER_WEB_ID, record.ownerWebId)
      .setUrl(NZ_SUBJECT_WEB_ID, record.subjectWebId)
      .setStringNoLocale(NZ_MODERATION_ACTION, record.action)
      .setStringNoLocale(NZ_CREATED_AT, record.createdAt)
    if (record.reasonCode) builder = builder.setStringNoLocale(NZ_REASON_CODE, record.reasonCode)

    await saveSolidDatasetAt(datasetUrl, setThing(dataset, builder.build()), {
      fetch: this.session.fetch,
    })
    return record
  }

  async removeModeration(
    podRoot: string,
    subjectWebId: string,
    action: ModerationAction
  ): Promise<void> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return
    const thingUrl = moderationThingUrl(podRoot, subjectWebId, action)
    if (!getThing(dataset, thingUrl)) return
    await saveSolidDatasetAt(
      moderationUrl(podRoot),
      removeThing(dataset, thingUrl),
      { fetch: this.session.fetch }
    )
  }

  async isBlocked(podRoot: string, subjectWebId: string): Promise<boolean> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return false
    return getThing(dataset, moderationThingUrl(podRoot, subjectWebId, 'block')) !== null
  }

  private async readDataset(
    podRoot: string
  ): Promise<(SolidDataset & Partial<WithServerResourceInfo>) | null> {
    try {
      return await getSolidDataset(moderationUrl(podRoot), { fetch: this.session.fetch })
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

function thingToModerationRecord(thing: Thing): ModerationRecord {
  const record: ModerationRecord = {
    version: getInteger(thing, NZ_VERSION) as 1,
    ownerWebId: getUrl(thing, NZ_OWNER_WEB_ID) ?? '',
    subjectWebId: getUrl(thing, NZ_SUBJECT_WEB_ID) ?? '',
    action: (getStringNoLocale(thing, NZ_MODERATION_ACTION) ?? '') as ModerationAction,
    createdAt: getStringNoLocale(thing, NZ_CREATED_AT) ?? '',
  }
  const reasonCode = getStringNoLocale(thing, NZ_REASON_CODE)
  if (reasonCode !== null) record.reasonCode = reasonCode
  return record
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } }
  return candidate.statusCode === 404 || candidate.status === 404 || candidate.response?.status === 404
}

export const MODERATION_DATASET_PATH = 'social/moderation/index'
