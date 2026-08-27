import { serializeRelationshipActivity } from './adapters/ActivityStreamsRelationshipAdapter.js'
import type {
  DeliveryReceipt,
  RelationshipActivity,
  SocialDeliveryStatus,
} from './contracts/ConsentfulDiscoveryContract.js'
import type { DeliveryReceiptManager } from './DeliveryReceiptManager.js'
import type { ModerationManager } from './ModerationManager.js'
import type { RelationshipOutboxManager } from './RelationshipOutboxManager.js'

export interface ActivityDelivererResult {
  status: number
  inboxUrl?: string
  location?: string
  error?: string
  code?: string
}

export type ActivityDeliverer = (input: {
  recipientWebId: string
  activity: RelationshipActivity
}) => Promise<ActivityDelivererResult>

export interface OutboxDeliveryWorkerOptions {
  deliverer?: ActivityDeliverer
  defaultMaxBatchSize?: number
  retryFailed?: boolean
}

export interface OutboxDeliveryItemResult {
  activityId: string
  recipientWebId: string
  status: SocialDeliveryStatus
  httpStatus?: number
  inboxUrl?: string
  location?: string
  errorCode?: string
  error?: string
}

export interface OutboxDeliveryBatchResult {
  total: number
  delivered: number
  failed: number
  rejected: number
  results: OutboxDeliveryItemResult[]
}

export class OutboxDeliveryError extends Error {
  constructor(message: string, readonly code: string, readonly status?: number) {
    super(message)
    this.name = 'OutboxDeliveryError'
  }
}

interface DeliveryReceiptStore {
  listDeliveryReceipts: DeliveryReceiptManager['listDeliveryReceipts']
  getDeliveryReceipt: DeliveryReceiptManager['getDeliveryReceipt']
  recordDeliveryReceipt: DeliveryReceiptManager['recordDeliveryReceipt']
}

interface RelationshipOutboxStore {
  readActivity: RelationshipOutboxManager['readActivity']
}

interface ModerationStore {
  isBlocked: ModerationManager['isBlocked']
}

const DEFAULT_BATCH_SIZE = 20

export class OutboxDeliveryWorker {
  private readonly deliverer?: ActivityDeliverer | undefined
  private readonly defaultMaxBatchSize: number
  private readonly retryFailedDefault: boolean

  constructor(
    private readonly receipts: DeliveryReceiptStore,
    private readonly outbox: RelationshipOutboxStore,
    private readonly moderation: ModerationStore,
    options: OutboxDeliveryWorkerOptions = {}
  ) {
    this.deliverer = options.deliverer
    this.defaultMaxBatchSize = options.defaultMaxBatchSize ?? DEFAULT_BATCH_SIZE
    this.retryFailedDefault = options.retryFailed ?? true
  }

  async deliverSingleActivity(input: {
    podRoot: string
    activity: RelationshipActivity
    recipientWebId: string
    deliverer?: ActivityDeliverer
    now?: Date
  }): Promise<OutboxDeliveryItemResult> {
    const nowIso = (input.now ?? new Date()).toISOString()
    const deliverer = input.deliverer ?? this.deliverer
    if (!deliverer) {
      const result: OutboxDeliveryItemResult = {
        activityId: input.activity.id,
        recipientWebId: input.recipientWebId,
        status: 'failed',
        errorCode: 'deliverer_unconfigured',
        error: 'No activity deliverer is configured on the worker or invocation.',
      }
      await this.recordReceipt(input.podRoot, input.activity, input.recipientWebId, 'failed', nowIso, 'deliverer_unconfigured')
      return result
    }

    if (await this.moderation.isBlocked(input.podRoot, input.recipientWebId)) {
      const result: OutboxDeliveryItemResult = {
        activityId: input.activity.id,
        recipientWebId: input.recipientWebId,
        status: 'rejected',
        errorCode: 'recipient_blocked',
        error: 'Recipient is blocked by local owner moderation policy.',
      }
      await this.recordReceipt(input.podRoot, input.activity, input.recipientWebId, 'rejected', nowIso, 'recipient_blocked')
      return result
    }

    await this.recordReceipt(input.podRoot, input.activity, input.recipientWebId, 'pending', nowIso)

    try {
      const response = await deliverer({
        recipientWebId: input.recipientWebId,
        activity: input.activity,
      })

      if (response.status >= 200 && response.status < 300) {
        const completedIso = (input.now ?? new Date()).toISOString()
        await this.recordReceipt(input.podRoot, input.activity, input.recipientWebId, 'delivered', completedIso)
        return {
          activityId: input.activity.id,
          recipientWebId: input.recipientWebId,
          status: 'delivered',
          httpStatus: response.status,
          ...(response.inboxUrl ? { inboxUrl: response.inboxUrl } : {}),
          ...(response.location ? { location: response.location } : {}),
        }
      }

      const completedIso = (input.now ?? new Date()).toISOString()
      const errorCode = response.code ?? 'delivery_failed'
      await this.recordReceipt(input.podRoot, input.activity, input.recipientWebId, 'failed', completedIso, errorCode)
      return {
        activityId: input.activity.id,
        recipientWebId: input.recipientWebId,
        status: 'failed',
        httpStatus: response.status,
        errorCode,
        error: response.error ?? `Remote inbox responded with status ${response.status}`,
      }
    } catch (error) {
      const completedIso = (input.now ?? new Date()).toISOString()
      const errorCode = error instanceof OutboxDeliveryError ? error.code : 'delivery_exception'
      const errorMessage = error instanceof Error ? error.message : 'Unknown delivery failure'
      await this.recordReceipt(input.podRoot, input.activity, input.recipientWebId, 'failed', completedIso, errorCode)
      return {
        activityId: input.activity.id,
        recipientWebId: input.recipientWebId,
        status: 'failed',
        errorCode,
        error: errorMessage,
      }
    }
  }

  async processPendingReceipts(input: {
    podRoot: string
    deliverer?: ActivityDeliverer
    maxBatchSize?: number
    retryFailed?: boolean
    now?: Date
  }): Promise<OutboxDeliveryBatchResult> {
    const retryFailed = input.retryFailed ?? this.retryFailedDefault
    const maxBatchSize = input.maxBatchSize ?? this.defaultMaxBatchSize

    const allReceipts = await this.receipts.listDeliveryReceipts(input.podRoot)
    const eligibleReceipts = allReceipts.filter((receipt) => {
      if (receipt.status === 'pending') return true
      if (retryFailed && receipt.status === 'failed') return true
      return false
    }).slice(0, maxBatchSize)

    const results: OutboxDeliveryItemResult[] = []
    let delivered = 0
    let failed = 0
    let rejected = 0

    for (const receipt of eligibleReceipts) {
      const activity = await this.outbox.readActivity(input.podRoot, receipt.activityId).catch(() => null)
      if (!activity) {
        const nowIso = (input.now ?? new Date()).toISOString()
        await this.receipts.recordDeliveryReceipt(input.podRoot, {
          version: 1,
          activityId: receipt.activityId,
          senderWebId: receipt.senderWebId,
          recipientWebId: receipt.recipientWebId,
          status: 'failed',
          updatedAt: nowIso,
          errorCode: 'activity_missing',
        })
        results.push({
          activityId: receipt.activityId,
          recipientWebId: receipt.recipientWebId,
          status: 'failed',
          errorCode: 'activity_missing',
          error: 'Outbox activity resource not found in owner outbox.',
        })
        failed += 1
        continue
      }

      const itemResult = await this.deliverSingleActivity({
        podRoot: input.podRoot,
        activity,
        recipientWebId: receipt.recipientWebId,
        ...(input.deliverer ? { deliverer: input.deliverer } : {}),
        ...(input.now ? { now: input.now } : {}),
      })
      results.push(itemResult)
      if (itemResult.status === 'delivered') delivered += 1
      else if (itemResult.status === 'rejected') rejected += 1
      else failed += 1
    }

    return {
      total: eligibleReceipts.length,
      delivered,
      failed,
      rejected,
      results,
    }
  }

  private async recordReceipt(
    podRoot: string,
    activity: RelationshipActivity,
    recipientWebId: string,
    status: SocialDeliveryStatus,
    updatedAt: string,
    errorCode?: string
  ): Promise<DeliveryReceipt> {
    const receipt: DeliveryReceipt = {
      version: 1,
      activityId: activity.id,
      senderWebId: activity.actor,
      recipientWebId,
      status,
      updatedAt,
      ...(errorCode ? { errorCode } : {}),
    }
    return this.receipts.recordDeliveryReceipt(podRoot, receipt)
  }
}

export function createProvisionerActivityDeliverer(input: {
  provisionerUrl: string
  authFetch: typeof globalThis.fetch
}): ActivityDeliverer {
  return async ({ recipientWebId, activity }): Promise<ActivityDelivererResult> => {
    const baseUrl = input.provisionerUrl.trim().replace(/\/+$/, '')
    if (!baseUrl) {
      throw new OutboxDeliveryError('Provisioner URL is not configured.', 'delivery_unconfigured')
    }

    const response = await input.authFetch(`${baseUrl}/v1/social/relationship-delivery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        recipientWebId,
        activity: serializeRelationshipActivity(activity),
      }),
    })

    const payload = (await response.json().catch(() => ({}))) as Partial<ActivityDelivererResult> & {
      error?: string
      code?: string
    }

    if (!response.ok) {
      return {
        status: response.status,
        error: payload.error ?? `Relationship delivery failed: HTTP ${response.status}`,
        code: payload.code ?? 'delivery_failed',
      }
    }

    return {
      status: response.status,
      ...(payload.inboxUrl ? { inboxUrl: payload.inboxUrl } : {}),
      ...(payload.location ? { location: payload.location } : {}),
    }
  }
}
