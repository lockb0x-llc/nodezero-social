import {
  parseRelationshipActivity,
} from './adapters/ActivityStreamsRelationshipAdapter.js'
import type {
  ProcessedActivityRecord,
  RelationshipActivity,
  RelationshipRecord,
  RelationshipState,
} from './contracts/ConsentfulDiscoveryContract.js'
import type { ProcessedActivityManager } from './ProcessedActivityManager.js'
import type { RelationshipManager } from './RelationshipManager.js'
import type { ModerationManager } from './ModerationManager.js'

export interface RelationshipInboxProcessorOptions {
  maxActivityAgeMs?: number
  maxFutureSkewMs?: number
  replayRetentionMs?: number
}

export interface ProcessRelationshipInboxInput {
  podRoot: string
  recipientWebId: string
  payload: unknown
  /** WebID established by the transport/server verification boundary. */
  verifiedActorWebId: string
  now?: Date
}

export interface RelationshipInboxResult {
  status: 'processed' | 'duplicate'
  activity: RelationshipActivity
  relationship: RelationshipRecord | null
}

export class RelationshipInboxError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'RelationshipInboxError'
  }
}

interface RelationshipStore {
  getRelationship: RelationshipManager['getRelationship']
  transitionRelationship: RelationshipManager['transitionRelationship']
}

interface ReplayStore {
  hasProcessedActivity: ProcessedActivityManager['hasProcessedActivity']
  recordProcessedActivity: ProcessedActivityManager['recordProcessedActivity']
}

interface ModerationStore {
  isBlocked: ModerationManager['isBlocked']
}

const DEFAULT_MAX_ACTIVITY_AGE_MS = 7 * 24 * 60 * 60_000
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60_000
const DEFAULT_REPLAY_RETENTION_MS = 30 * 24 * 60 * 60_000

export class RelationshipInboxProcessor {
  private readonly maxActivityAgeMs: number
  private readonly maxFutureSkewMs: number
  private readonly replayRetentionMs: number

  constructor(
    private readonly relationships: RelationshipStore,
    private readonly replay: ReplayStore,
    private readonly moderation: ModerationStore,
    options: RelationshipInboxProcessorOptions = {}
  ) {
    this.maxActivityAgeMs = options.maxActivityAgeMs ?? DEFAULT_MAX_ACTIVITY_AGE_MS
    this.maxFutureSkewMs = options.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS
    this.replayRetentionMs = options.replayRetentionMs ?? DEFAULT_REPLAY_RETENTION_MS
  }

  async process(input: ProcessRelationshipInboxInput): Promise<RelationshipInboxResult> {
    const activity = parseActivity(input.payload)
    const now = input.now ?? new Date()
    validateVerifiedActor(activity, input.verifiedActorWebId)
    validateActivityTime(activity, now, this.maxActivityAgeMs, this.maxFutureSkewMs)
    validateRecipient(activity, input.recipientWebId)
    if (await this.moderation.isBlocked(input.podRoot, activity.actor)) {
      throw new RelationshipInboxError(
        'Activity actor is blocked by the inbox owner.',
        'actor_blocked'
      )
    }

    if (await this.replay.hasProcessedActivity(input.podRoot, activity.id, now)) {
      return { status: 'duplicate', activity, relationship: null }
    }

    const relationship = await this.applyActivity(input.podRoot, activity, now)
    const replayRecord: ProcessedActivityRecord = {
      version: 1,
      activityId: activity.id,
      actorWebId: activity.actor,
      processedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.replayRetentionMs).toISOString(),
    }
    await this.replay.recordProcessedActivity(input.podRoot, replayRecord)
    return { status: 'processed', activity, relationship }
  }

  private async applyActivity(
    podRoot: string,
    activity: RelationshipActivity,
    now: Date
  ): Promise<RelationshipRecord> {
    if (activity.type === 'Block') {
      throw new RelationshipInboxError(
        'Block activities are private local moderation state.',
        'block_not_processed'
      )
    }

    if (activity.type === 'Follow') {
      return this.relationships.transitionRelationship(podRoot, {
        peerWebId: activity.actor,
        to: 'incoming-pending',
        updatedAt: now.toISOString(),
        activityId: activity.id,
      })
    }

    if (activity.type === 'Accept' || activity.type === 'Reject') {
      const existing = await this.relationships.getRelationship(podRoot, activity.actor)
      if (!existing || existing.state !== 'outgoing-pending') {
        throw new RelationshipInboxError(
          `${activity.type} requires an outgoing-pending relationship.`,
          'relationship_state_mismatch'
        )
      }
      if (existing.activityId !== activity.inReplyTo) {
        throw new RelationshipInboxError(
          `${activity.type} does not reference the pending Follow activity.`,
          'activity_reference_mismatch'
        )
      }
      return this.relationships.transitionRelationship(podRoot, {
        peerWebId: activity.actor,
        to: activity.type === 'Accept' ? 'accepted' : 'rejected',
        updatedAt: now.toISOString(),
        activityId: activity.id,
      })
    }

    const existing = await this.relationships.getRelationship(podRoot, activity.actor)
    if (!existing || existing.activityId !== activity.inReplyTo) {
      throw new RelationshipInboxError(
        'Undo does not reference the current relationship activity.',
        'activity_reference_mismatch'
      )
    }
    const target = undoTarget(existing.state)
    if (!target) {
      throw new RelationshipInboxError(
        `Undo is not valid for relationship state ${existing.state}.`,
        'relationship_state_mismatch'
      )
    }
    return this.relationships.transitionRelationship(podRoot, {
      peerWebId: activity.actor,
      to: target,
      updatedAt: now.toISOString(),
      activityId: activity.id,
    })
  }
}

function parseActivity(payload: unknown): RelationshipActivity {
  try {
    return parseRelationshipActivity(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Relationship activity is invalid.'
    throw new RelationshipInboxError(message, 'invalid_activity')
  }
}

function validateVerifiedActor(activity: RelationshipActivity, verifiedActorWebId: string): void {
  if (activity.actor !== verifiedActorWebId) {
    throw new RelationshipInboxError(
      'Activity actor does not match the verified sender.',
      'actor_verification_mismatch'
    )
  }
}

function validateActivityTime(
  activity: RelationshipActivity,
  now: Date,
  maxAgeMs: number,
  maxFutureSkewMs: number
): void {
  const publishedAt = Date.parse(activity.publishedAt)
  if (publishedAt < now.getTime() - maxAgeMs) {
    throw new RelationshipInboxError('Activity is too old to process.', 'activity_expired')
  }
  if (publishedAt > now.getTime() + maxFutureSkewMs) {
    throw new RelationshipInboxError('Activity timestamp is too far in the future.', 'activity_from_future')
  }
}

function validateRecipient(activity: RelationshipActivity, recipientWebId: string): void {
  if (activity.actor === recipientWebId) {
    throw new RelationshipInboxError('Activity actor cannot be the recipient.', 'self_activity')
  }
  if (activity.type === 'Follow' && activity.object !== recipientWebId) {
    throw new RelationshipInboxError(
      'Follow activity object does not match the inbox owner.',
      'recipient_mismatch'
    )
  }
}

function undoTarget(state: RelationshipState): RelationshipState | null {
  if (state === 'incoming-pending') return 'cancelled'
  if (state === 'accepted' || state === 'legacy-connected') return 'disconnected'
  return null
}
