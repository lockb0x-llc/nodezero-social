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

interface ReplayReservationSnapshot {
  record: ProcessedActivityRecord
  state: 'reserved' | 'processed'
  etag: string | null
}

export interface ProcessedActivityLease {
  activityId: string
  etag: string
}

export type ProcessedActivityReservation =
  | { status: 'acquired'; lease: ProcessedActivityLease }
  | { status: 'in-progress' | 'duplicate' | 'actor-mismatch' }

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

function reservationUrl(podRoot: string, activityId: string): string {
  return `${podRoot.replace(/\/$/, '')}/social/processed-activities/activity-${encodeURIComponent(activityId)}`
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

  async reserveProcessedActivity(
    podRoot: string,
    record: ProcessedActivityRecord,
    now = new Date()
  ): Promise<ProcessedActivityReservation> {
    await this.ensurePodLayoutIfEnabled(podRoot)
    assertValidProcessedActivityRecord(record)
    const targetUrl = reservationUrl(podRoot, record.activityId)
    const response = await this.writeReservation(targetUrl, record, 'reserved', true)
    if (response.status !== 409 && response.status !== 412) {
      if (!response.ok) throw new Error(`Unable to reserve activity replay record: HTTP ${response.status}`)
      const created = await this.readReservation(targetUrl)
      if (!created?.etag || created.state !== 'reserved') {
        throw new Error('Activity replay reservation did not return an ownership ETag.')
      }
      return { status: 'acquired', lease: { activityId: record.activityId, etag: created.etag } }
    }
    const existing = await this.readReservation(targetUrl)
    if (!existing) return { status: 'in-progress' }
    if (existing.record.actorWebId !== record.actorWebId) return { status: 'actor-mismatch' }
    if (existing.state === 'processed') return { status: 'duplicate' }
    if (Date.parse(existing.record.expiresAt) > now.getTime()) return { status: 'in-progress' }
    if (!existing.etag) return { status: 'in-progress' }
    const removed = await this.session.fetch(targetUrl, {
      method: 'DELETE',
      headers: { 'If-Match': existing.etag },
    })
    if (removed.status === 409 || removed.status === 412) return { status: 'in-progress' }
    if (!removed.ok && removed.status !== 404) {
      throw new Error(`Unable to reclaim expired activity replay record: HTTP ${removed.status}`)
    }
    const retry = await this.writeReservation(targetUrl, record, 'reserved', true)
    if (retry.status === 409 || retry.status === 412) return { status: 'in-progress' }
    if (!retry.ok) throw new Error(`Unable to reserve activity replay record: HTTP ${retry.status}`)
    const reclaimed = await this.readReservation(targetUrl)
    if (!reclaimed?.etag || reclaimed.state !== 'reserved') {
      throw new Error('Reclaimed activity replay reservation did not return an ownership ETag.')
    }
    return { status: 'acquired', lease: { activityId: record.activityId, etag: reclaimed.etag } }
  }

  private writeReservation(
    targetUrl: string,
    record: ProcessedActivityRecord,
    state: 'reserved' | 'processed',
    createOnly: boolean
  ): Promise<Response> {
    return this.session.fetch(targetUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle',
        ...(createOnly ? { 'If-None-Match': '*' } : {}),
      },
      body: serializeProcessedActivity(record, state),
    })
  }

  private async readReservation(targetUrl: string): Promise<ReplayReservationSnapshot | null> {
    const response = await this.session.fetch(targetUrl, {
      headers: { Accept: 'text/turtle' },
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Unable to read activity replay reservation: HTTP ${response.status}`)
    const responseUrl = response.url || targetUrl
    const body = await response.text()
    const expiresAt = /nz:expiresAt\s+"([^"]+)"/.exec(body)?.[1]
    const processedAt = /nz:processedAt\s+"([^"]+)"/.exec(body)?.[1]
    const actorWebId = /nz:actorWebId\s+<([^>]+)>/.exec(body)?.[1]
    const activityId = /nz:activityId\s+<([^>]+)>/.exec(body)?.[1]
    const state = /nz:processingState\s+"(reserved|processed)"/.exec(body)?.[1] as
      | 'reserved'
      | 'processed'
      | undefined
    if (!expiresAt || !processedAt || !actorWebId || !activityId || !state) {
      throw new Error(`Activity replay reservation is invalid: ${responseUrl}`)
    }
    const record: ProcessedActivityRecord = {
      version: 1,
      activityId,
      actorWebId,
      processedAt,
      expiresAt,
    }
    assertValidProcessedActivityRecord(record)
    return { record, state, etag: response.headers.get('etag') }
  }

  async commitProcessedActivity(
    podRoot: string,
    record: ProcessedActivityRecord,
    lease: ProcessedActivityLease
  ): Promise<ProcessedActivityRecord> {
    assertValidProcessedActivityRecord(record)
    if (lease.activityId !== record.activityId) throw new Error('Replay lease activity mismatch.')
    const response = await this.session.fetch(reservationUrl(podRoot, record.activityId), {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle',
        'If-Match': lease.etag,
      },
      body: serializeProcessedActivity(record, 'processed'),
    })
    if (response.status === 409 || response.status === 412) {
      throw new Error('Activity replay lease was lost before commit.')
    }
    if (!response.ok) throw new Error(`Unable to commit activity replay record: HTTP ${response.status}`)
    return record
  }

  async releaseProcessedActivity(podRoot: string, lease: ProcessedActivityLease): Promise<void> {
    const response = await this.session.fetch(reservationUrl(podRoot, lease.activityId), {
      method: 'DELETE',
      headers: { 'If-Match': lease.etag },
    })
    if (response.status === 409 || response.status === 412) return
    if (response.status === 404) return
    if (!response.ok) throw new Error(`Unable to release activity replay record: HTTP ${response.status}`)
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

function serializeProcessedActivity(
  record: ProcessedActivityRecord,
  state: 'reserved' | 'processed' = 'processed'
): string {
  return `@prefix nz: <https://nodezero.social/ns#> .
<#activity> a nz:ProcessedActivity ;
  nz:version ${record.version} ;
  nz:activityId <${record.activityId}> ;
  nz:actorWebId <${record.actorWebId}> ;
  nz:processingState ${JSON.stringify(state)} ;
  nz:processedAt ${JSON.stringify(record.processedAt)} ;
  nz:expiresAt ${JSON.stringify(record.expiresAt)} .
`
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
