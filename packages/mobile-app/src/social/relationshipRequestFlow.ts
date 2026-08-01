import type {
  DeliveryReceipt,
  RelationshipActivity,
  RelationshipRecord,
} from '@nodezero/solid-pod-sync'
import { serializeRelationshipActivity } from '@nodezero/solid-pod-sync'
import type {
  DeliveryReceiptManager,
  ModerationManager,
  RelationshipFoafProjector,
  RelationshipManager,
  RelationshipOutboxManager,
} from '@nodezero/solid-pod-sync'

export interface RelationshipDeliveryResponse {
  activityId: string
  recipientWebId: string
  status: number
  inboxUrl: string
  location?: string
}

export interface SendRelationshipRequestInput {
  podRoot: string
  ownerWebId: string
  recipientWebId: string
  provisionerUrl: string
  authFetch: typeof globalThis.fetch
  managers: {
    relationshipManager: Pick<
      RelationshipManager,
      'getRelationship' | 'transitionRelationship'
    >
    moderationManager: Pick<ModerationManager, 'isBlocked'>
    relationshipOutboxManager: Pick<
      RelationshipOutboxManager,
      'writeActivity' | 'readActivity'
    >
    deliveryReceiptManager: Pick<DeliveryReceiptManager, 'recordDeliveryReceipt'>
    relationshipFoafProjector: Pick<RelationshipFoafProjector, 'project'>
  }
  now?: Date
  activityId?: string
}

export interface SendRelationshipRequestResult {
  activity: RelationshipActivity
  relationship: RelationshipRecord
  delivery: RelationshipDeliveryResponse
}

export interface DisconnectRelationshipInput extends SendRelationshipRequestInput {}

export interface RespondRelationshipRequestInput extends SendRelationshipRequestInput {
  decision: 'accept' | 'reject'
}

export class RelationshipRequestError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'RelationshipRequestError'
  }
}

export async function sendRelationshipRequest(
  input: SendRelationshipRequestInput
): Promise<SendRelationshipRequestResult> {
  const existing = await input.managers.relationshipManager.getRelationship(
    input.podRoot,
    input.recipientWebId
  )
  if (await input.managers.moderationManager.isBlocked(input.podRoot, input.recipientWebId)) {
    throw new RelationshipRequestError('Unblock this person before sending a request.', 'recipient_blocked')
  }
  if (existing?.state === 'accepted') {
    throw new RelationshipRequestError('This relationship is already accepted.', 'already_accepted')
  }
  if (existing?.state === 'outgoing-pending') {
    if (!existing.activityId) {
      throw new RelationshipRequestError(
        'Pending relationship is missing its outbox activity.',
        'relationship_correlation_missing'
      )
    }
    const activity = await input.managers.relationshipOutboxManager.readActivity(
      input.podRoot,
      existing.activityId
    )
    if (
      !activity ||
      activity.type !== 'Follow' ||
      activity.actor !== input.ownerWebId ||
      activity.object !== input.recipientWebId
    ) {
      throw new RelationshipRequestError(
        'Pending relationship outbox activity is unavailable or invalid.',
        'pending_activity_unavailable'
      )
    }
    await recordReceipt(input, activity, 'pending', new Date().toISOString())
    try {
      const delivery = await deliverActivity(input, activity)
      await recordReceipt(input, activity, 'delivered', new Date().toISOString())
      return { activity, relationship: existing, delivery }
    } catch (error) {
      const errorCode = error instanceof RelationshipRequestError ? error.code : 'delivery_failed'
      await recordReceipt(input, activity, 'failed', new Date().toISOString(), errorCode)
      throw error
    }
  }

  const now = input.now ?? new Date()
  const activity: RelationshipActivity = {
    version: 1,
    id: input.activityId ?? createActivityId(input.podRoot, 'follow', now),
    type: 'Follow',
    actor: input.ownerWebId,
    object: input.recipientWebId,
    publishedAt: now.toISOString(),
  }
  await input.managers.relationshipOutboxManager.writeActivity(input.podRoot, activity)
  const relationship = await input.managers.relationshipManager.transitionRelationship(
    input.podRoot,
    {
      peerWebId: input.recipientWebId,
      to: 'outgoing-pending',
      updatedAt: activity.publishedAt,
      activityId: activity.id,
    }
  )

  await recordReceipt(input, activity, 'pending', activity.publishedAt)
  try {
    const delivery = await deliverActivity(input, activity)
    await recordReceipt(input, activity, 'delivered', new Date().toISOString())
    return { activity, relationship, delivery }
  } catch (error) {
    const errorCode = error instanceof RelationshipRequestError ? error.code : 'delivery_failed'
    await recordReceipt(input, activity, 'failed', new Date().toISOString(), errorCode)
    throw error
  }
}

export async function disconnectRelationship(
  input: DisconnectRelationshipInput
): Promise<RelationshipRecord> {
  const existing = await input.managers.relationshipManager.getRelationship(
    input.podRoot,
    input.recipientWebId
  )
  if (!existing || (existing.state !== 'accepted' && existing.state !== 'legacy-connected')) {
    throw new RelationshipRequestError(
      'Only accepted or legacy relationships can be disconnected.',
      'relationship_not_connected'
    )
  }

  const now = input.now ?? new Date()
  if (existing.state === 'legacy-connected') {
    const disconnected = await input.managers.relationshipManager.transitionRelationship(
      input.podRoot,
      {
        peerWebId: input.recipientWebId,
        to: 'disconnected',
        updatedAt: now.toISOString(),
      }
    )
    await input.managers.relationshipFoafProjector.project(input.podRoot, disconnected)
    return disconnected
  }
  if (!existing.activityId) {
    throw new RelationshipRequestError(
      'Accepted relationship is missing its correlation activity.',
      'relationship_correlation_missing'
    )
  }

  const activity: RelationshipActivity = {
    version: 1,
    id: input.activityId ?? createActivityId(input.podRoot, 'undo', now),
    type: 'Undo',
    actor: input.ownerWebId,
    object: existing.activityId,
    publishedAt: now.toISOString(),
    inReplyTo: existing.activityId,
  }
  await input.managers.relationshipOutboxManager.writeActivity(input.podRoot, activity)
  await recordReceipt(input, activity, 'pending', activity.publishedAt)
  try {
    await deliverActivity(input, activity)
    const disconnected = await input.managers.relationshipManager.transitionRelationship(
      input.podRoot,
      {
        peerWebId: input.recipientWebId,
        to: 'disconnected',
        updatedAt: new Date().toISOString(),
        activityId: activity.id,
      }
    )
    await input.managers.relationshipFoafProjector.project(input.podRoot, disconnected)
    await recordReceipt(input, activity, 'delivered', disconnected.updatedAt)
    return disconnected
  } catch (error) {
    const errorCode = error instanceof RelationshipRequestError ? error.code : 'delivery_failed'
    await recordReceipt(input, activity, 'failed', new Date().toISOString(), errorCode)
    throw error
  }
}

export async function respondToRelationshipRequest(
  input: RespondRelationshipRequestInput
): Promise<RelationshipRecord> {
  const existing = await input.managers.relationshipManager.getRelationship(
    input.podRoot,
    input.recipientWebId
  )
  if (!existing || existing.state !== 'incoming-pending' || !existing.activityId) {
    throw new RelationshipRequestError(
      'A correlated incoming relationship request is required.',
      'incoming_request_unavailable'
    )
  }
  if (await input.managers.moderationManager.isBlocked(input.podRoot, input.recipientWebId)) {
    throw new RelationshipRequestError(
      'Blocked relationship requests cannot be accepted or answered.',
      'recipient_blocked'
    )
  }

  const now = input.now ?? new Date()
  const type = input.decision === 'accept' ? 'Accept' : 'Reject'
  const activity: RelationshipActivity = {
    version: 1,
    id: input.activityId ?? createActivityId(input.podRoot, type.toLowerCase(), now),
    type,
    actor: input.ownerWebId,
    object: existing.activityId,
    publishedAt: now.toISOString(),
    inReplyTo: existing.activityId,
  }
  await input.managers.relationshipOutboxManager.writeActivity(input.podRoot, activity)
  await recordReceipt(input, activity, 'pending', activity.publishedAt)
  try {
    await deliverActivity(input, activity)
    const relationship = await input.managers.relationshipManager.transitionRelationship(
      input.podRoot,
      {
        peerWebId: input.recipientWebId,
        to: input.decision === 'accept' ? 'accepted' : 'rejected',
        updatedAt: new Date().toISOString(),
        activityId: activity.id,
      }
    )
    if (relationship.state === 'accepted') {
      await input.managers.relationshipFoafProjector.project(input.podRoot, relationship)
    }
    await recordReceipt(input, activity, 'delivered', relationship.updatedAt)
    return relationship
  } catch (error) {
    const errorCode = error instanceof RelationshipRequestError ? error.code : 'delivery_failed'
    await recordReceipt(input, activity, 'failed', new Date().toISOString(), errorCode)
    throw error
  }
}

async function deliverActivity(
  input: SendRelationshipRequestInput,
  activity: RelationshipActivity
): Promise<RelationshipDeliveryResponse> {
  const baseUrl = input.provisionerUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) {
    throw new RelationshipRequestError('Relationship delivery is not configured.', 'delivery_unconfigured')
  }
  const response = await input.authFetch(`${baseUrl}/v1/social/relationship-delivery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      recipientWebId: input.recipientWebId,
      activity: serializeRelationshipActivity(activity),
    }),
  })
  const payload = await response.json().catch(() => ({})) as Partial<RelationshipDeliveryResponse> & {
    error?: string
    code?: string
  }
  if (!response.ok) {
    throw new RelationshipRequestError(
      payload.error ?? `Relationship delivery failed with HTTP ${response.status}.`,
      payload.code ?? 'delivery_failed'
    )
  }
  if (
    payload.activityId !== activity.id ||
    payload.recipientWebId !== input.recipientWebId ||
    typeof payload.inboxUrl !== 'string' ||
    typeof payload.status !== 'number'
  ) {
    throw new RelationshipRequestError(
      'Relationship delivery returned an invalid response.',
      'invalid_delivery_response'
    )
  }
  return payload as RelationshipDeliveryResponse
}

async function recordReceipt(
  input: SendRelationshipRequestInput,
  activity: RelationshipActivity,
  status: DeliveryReceipt['status'],
  updatedAt: string,
  errorCode?: string
): Promise<void> {
  await input.managers.deliveryReceiptManager.recordDeliveryReceipt(input.podRoot, {
    version: 1,
    activityId: activity.id,
    senderWebId: input.ownerWebId,
    recipientWebId: input.recipientWebId,
    status,
    updatedAt,
    ...(errorCode ? { errorCode } : {}),
  })
}

function createActivityId(podRoot: string, type: string, now: Date): string {
  const entropy = Math.random().toString(36).slice(2, 12)
  return `${podRoot.replace(/\/$/, '')}/social/outbox/${type}-${now.getTime()}-${entropy}.jsonld`
}
