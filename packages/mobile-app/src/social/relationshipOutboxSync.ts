import {
  OutboxDeliveryWorker,
  createProvisionerActivityDeliverer,
  type OutboxDeliveryBatchResult,
  type DeliveryReceiptManager,
  type RelationshipOutboxManager,
  type ModerationManager,
} from '@nodezero/solid-pod-sync'

export interface SyncRelationshipOutboxInput {
  podRoot: string
  provisionerUrl: string
  authFetch: typeof globalThis.fetch
  managers: {
    deliveryReceiptManager: Pick<DeliveryReceiptManager, 'listDeliveryReceipts' | 'recordDeliveryReceipt'>
    relationshipOutboxManager: Pick<RelationshipOutboxManager, 'readActivity'>
    moderationManager: Pick<ModerationManager, 'isBlocked'>
  }
  maxBatchSize?: number
  retryFailed?: boolean
  now?: Date
}

export async function syncRelationshipOutbox(
  input: SyncRelationshipOutboxInput
): Promise<OutboxDeliveryBatchResult> {
  const deliverer = createProvisionerActivityDeliverer({
    provisionerUrl: input.provisionerUrl,
    authFetch: input.authFetch,
  })

  const worker = new OutboxDeliveryWorker(
    input.managers.deliveryReceiptManager as unknown as DeliveryReceiptManager,
    input.managers.relationshipOutboxManager as unknown as RelationshipOutboxManager,
    input.managers.moderationManager as unknown as ModerationManager,
    { deliverer }
  )

  return worker.processPendingReceipts({
    podRoot: input.podRoot,
    maxBatchSize: input.maxBatchSize,
    retryFailed: input.retryFailed,
    now: input.now,
  })
}
