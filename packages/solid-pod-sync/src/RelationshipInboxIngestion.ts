import { parseRelationshipActivity } from './adapters/ActivityStreamsRelationshipAdapter.js'
import type { RelationshipActivity } from './contracts/ConsentfulDiscoveryContract.js'
import {
  RelationshipInboxError,
  type RelationshipInboxResult,
} from './RelationshipInboxProcessor.js'
import type {
  RelationshipInboxProcessor,
} from './RelationshipInboxProcessor.js'
import type {
  QuarantinedRelationshipActivity,
  RelationshipQuarantineManager,
} from './RelationshipQuarantineManager.js'

export interface RelationshipSenderVerifier {
  verifySender(input: {
    activity: RelationshipActivity
    payload: unknown
    sourceUrl?: string
  }): Promise<string | null>
}

export interface IngestRelationshipActivityInput {
  podRoot: string
  recipientWebId: string
  payload: unknown
  sourceUrl?: string
  receivedAt?: Date
}

export type RelationshipInboxIngestionResult =
  | { status: 'processed' | 'duplicate' | 'in-progress'; result: RelationshipInboxResult }
  | { status: 'quarantined'; record: QuarantinedRelationshipActivity }

interface InboxProcessor {
  process: RelationshipInboxProcessor['process']
}

interface QuarantineStore {
  quarantine: RelationshipQuarantineManager['quarantine']
}

export class RelationshipInboxIngestion {
  constructor(
    private readonly processor: InboxProcessor,
    private readonly quarantineStore: QuarantineStore,
    private readonly senderVerifier: RelationshipSenderVerifier
  ) {}

  async ingest(input: IngestRelationshipActivityInput): Promise<RelationshipInboxIngestionResult> {
    const receivedAt = input.receivedAt ?? new Date()
    const payloadJson = boundedPayloadJson(input.payload)
    let activity: RelationshipActivity
    try {
      activity = parseRelationshipActivity(input.payload)
    } catch {
      return this.quarantine(input, receivedAt, payloadJson, 'invalid_activity')
    }

    let verifiedActorWebId: string | null
    try {
      verifiedActorWebId = await this.senderVerifier.verifySender({
        activity,
        payload: input.payload,
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      })
    } catch (error) {
      if (isRetryableVerificationError(error)) throw error
      return this.quarantine(
        input,
        receivedAt,
        payloadJson,
        'sender_verification_failed',
        activity
      )
    }
    if (!verifiedActorWebId) {
      return this.quarantine(input, receivedAt, payloadJson, 'sender_unverified', activity)
    }
    if (verifiedActorWebId !== activity.actor) {
      return this.quarantine(
        input,
        receivedAt,
        payloadJson,
        'sender_actor_mismatch',
        activity
      )
    }

    try {
      const result = await this.processor.process({
        podRoot: input.podRoot,
        recipientWebId: input.recipientWebId,
        payload: input.payload,
        verifiedActorWebId,
        now: receivedAt,
      })
      return { status: result.status, result }
    } catch (error) {
      if (!(error instanceof RelationshipInboxError)) throw error
      const reasonCode = getErrorCode(error) ?? 'processing_rejected'
      return this.quarantine(input, receivedAt, payloadJson, reasonCode, activity)
    }
  }

  private async quarantine(
    input: IngestRelationshipActivityInput,
    receivedAt: Date,
    payloadJson: string,
    reasonCode: string,
    activity?: RelationshipActivity
  ): Promise<RelationshipInboxIngestionResult> {
    const quarantineId = `${receivedAt.getTime()}-${hashText(activity?.id ?? payloadJson)}`
    const record: QuarantinedRelationshipActivity = {
      version: 1,
      quarantineId,
      receivedAt: receivedAt.toISOString(),
      reasonCode,
      payloadJson,
      ...(activity ? { activityId: activity.id, claimedActorWebId: activity.actor } : {}),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    }
    await this.quarantineStore.quarantine(input.podRoot, record)
    return { status: 'quarantined', record }
  }
}

function boundedPayloadJson(payload: unknown): string {
  let serialized: string
  try {
    serialized = JSON.stringify(payload) ?? 'null'
  } catch {
    serialized = JSON.stringify({ unserializable: true })
  }
  const maxBytes = 60 * 1024
  if (new TextEncoder().encode(serialized).byteLength <= maxBytes) return serialized
  return JSON.stringify({ oversized: true, byteLength: new TextEncoder().encode(serialized).byteLength })
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.trim() ? code : null
}

function isRetryableVerificationError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { retryable?: unknown }).retryable === true
  )
}
