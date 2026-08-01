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
  assertValidDeliveryReceipt,
  type DeliveryReceipt,
  type SocialDeliveryStatus,
} from './contracts/ConsentfulDiscoveryContract.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface DeliveryReceiptManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
  }
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const NZ_DELIVERY_RECEIPT = 'https://nodezero.social/ns#DeliveryReceipt'
const NZ_VERSION = 'https://nodezero.social/ns#version'
const NZ_ACTIVITY_ID = 'https://nodezero.social/ns#activityId'
const NZ_SENDER_WEB_ID = 'https://nodezero.social/ns#senderWebId'
const NZ_RECIPIENT_WEB_ID = 'https://nodezero.social/ns#recipientWebId'
const NZ_DELIVERY_STATUS = 'https://nodezero.social/ns#deliveryStatus'
const NZ_UPDATED_AT = 'https://nodezero.social/ns#updatedAt'
const NZ_ERROR_CODE = 'https://nodezero.social/ns#errorCode'

function receiptsUrl(podRoot: string): string {
  return `${podRoot.replace(/\/$/, '')}/social/delivery-receipts/index`
}

function receiptThingUrl(podRoot: string, activityId: string): string {
  return `${receiptsUrl(podRoot)}#activity-${encodeURIComponent(activityId)}`
}

export class DeliveryReceiptManager {
  constructor(
    private readonly session: AuthenticatedSession,
    private readonly options: DeliveryReceiptManagerOptions = {}
  ) {}

  async listDeliveryReceipts(podRoot: string): Promise<DeliveryReceipt[]> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return []
    const receipts: DeliveryReceipt[] = []
    for (const thing of getThingAll(dataset)) {
      if (getUrl(thing, RDF_TYPE) !== NZ_DELIVERY_RECEIPT) continue
      const receipt = thingToDeliveryReceipt(thing)
      assertValidDeliveryReceipt(receipt)
      receipts.push(receipt)
    }
    return receipts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async getDeliveryReceipt(podRoot: string, activityId: string): Promise<DeliveryReceipt | null> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return null
    const thing = getThing(dataset, receiptThingUrl(podRoot, activityId))
    if (!thing) return null
    const receipt = thingToDeliveryReceipt(thing)
    assertValidDeliveryReceipt(receipt)
    return receipt
  }

  async recordDeliveryReceipt(
    podRoot: string,
    receipt: DeliveryReceipt
  ): Promise<DeliveryReceipt> {
    await this.ensurePodLayoutIfEnabled(podRoot)
    assertValidDeliveryReceipt(receipt)
    const datasetUrl = receiptsUrl(podRoot)
    const thingUrl = receiptThingUrl(podRoot, receipt.activityId)
    const dataset = (await this.readDataset(podRoot)) ?? createSolidDataset()
    const existing = getThing(dataset, thingUrl) ?? createThing({ url: thingUrl })
    let builder = buildThing(existing)
      .removeAll(RDF_TYPE)
      .removeAll(NZ_VERSION)
      .removeAll(NZ_ACTIVITY_ID)
      .removeAll(NZ_SENDER_WEB_ID)
      .removeAll(NZ_RECIPIENT_WEB_ID)
      .removeAll(NZ_DELIVERY_STATUS)
      .removeAll(NZ_UPDATED_AT)
      .removeAll(NZ_ERROR_CODE)
      .setUrl(RDF_TYPE, NZ_DELIVERY_RECEIPT)
      .setInteger(NZ_VERSION, receipt.version)
      .setUrl(NZ_ACTIVITY_ID, receipt.activityId)
      .setUrl(NZ_SENDER_WEB_ID, receipt.senderWebId)
      .setUrl(NZ_RECIPIENT_WEB_ID, receipt.recipientWebId)
      .setStringNoLocale(NZ_DELIVERY_STATUS, receipt.status)
      .setStringNoLocale(NZ_UPDATED_AT, receipt.updatedAt)
    if (receipt.errorCode) builder = builder.setStringNoLocale(NZ_ERROR_CODE, receipt.errorCode)
    await saveSolidDatasetAt(datasetUrl, setThing(dataset, builder.build()), {
      fetch: this.session.fetch,
    })
    return receipt
  }

  async removeDeliveryReceipt(podRoot: string, activityId: string): Promise<void> {
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return
    const thingUrl = receiptThingUrl(podRoot, activityId)
    if (!getThing(dataset, thingUrl)) return
    await saveSolidDatasetAt(receiptsUrl(podRoot), removeThing(dataset, thingUrl), {
      fetch: this.session.fetch,
    })
  }

  private async readDataset(
    podRoot: string
  ): Promise<(SolidDataset & Partial<WithServerResourceInfo>) | null> {
    try {
      return await getSolidDataset(receiptsUrl(podRoot), { fetch: this.session.fetch })
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

function thingToDeliveryReceipt(thing: Thing): DeliveryReceipt {
  const receipt: DeliveryReceipt = {
    version: getInteger(thing, NZ_VERSION) as 1,
    activityId: getUrl(thing, NZ_ACTIVITY_ID) ?? '',
    senderWebId: getUrl(thing, NZ_SENDER_WEB_ID) ?? '',
    recipientWebId: getUrl(thing, NZ_RECIPIENT_WEB_ID) ?? '',
    status: (getStringNoLocale(thing, NZ_DELIVERY_STATUS) ?? '') as SocialDeliveryStatus,
    updatedAt: getStringNoLocale(thing, NZ_UPDATED_AT) ?? '',
  }
  const errorCode = getStringNoLocale(thing, NZ_ERROR_CODE)
  if (errorCode !== null) receipt.errorCode = errorCode
  return receipt
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } }
  return candidate.statusCode === 404 || candidate.status === 404 || candidate.response?.status === 404
}

export const DELIVERY_RECEIPTS_DATASET_PATH = 'social/delivery-receipts/index'
