import {
  assertValidRelationshipActivity,
  type RelationshipActivity,
  type RelationshipActivityType,
} from '../contracts/ConsentfulDiscoveryContract.js'

export const ACTIVITYSTREAMS_CONTEXT = 'https://www.w3.org/ns/activitystreams'

export interface ActivityStreamsRelationshipDocument {
  '@context': typeof ACTIVITYSTREAMS_CONTEXT
  id: string
  type: RelationshipActivityType
  actor: string
  object: string
  published: string
  inReplyTo?: string
}

export class ActivityStreamsRelationshipError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'ActivityStreamsRelationshipError'
  }
}

export function serializeRelationshipActivity(
  activity: RelationshipActivity
): ActivityStreamsRelationshipDocument {
  assertValidRelationshipActivity(activity)
  const document: ActivityStreamsRelationshipDocument = {
    '@context': ACTIVITYSTREAMS_CONTEXT,
    id: activity.id,
    type: activity.type,
    actor: activity.actor,
    object: activity.object,
    published: activity.publishedAt,
  }
  if (activity.inReplyTo !== undefined) document.inReplyTo = activity.inReplyTo
  return document
}

export function parseRelationshipActivity(payload: unknown): RelationshipActivity {
  if (!isPlainObject(payload)) {
    throw new ActivityStreamsRelationshipError('Activity payload must be an object.', 'invalid_payload')
  }
  if (!hasActivityStreamsContext(payload['@context'])) {
    throw new ActivityStreamsRelationshipError(
      'Activity payload must include the ActivityStreams context.',
      'invalid_context'
    )
  }

  const type = asString(payload.type) as RelationshipActivityType | null
  const activity: RelationshipActivity = {
    version: 1,
    id: asString(payload.id) ?? '',
    type: type ?? ('' as RelationshipActivityType),
    actor: extractId(payload.actor),
    object: extractId(payload.object),
    publishedAt: asString(payload.published) ?? '',
  }
  const inReplyTo = extractOptionalId(payload.inReplyTo)
  if (inReplyTo !== undefined) activity.inReplyTo = inReplyTo

  try {
    assertValidRelationshipActivity(activity)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Activity contract validation failed.'
    throw new ActivityStreamsRelationshipError(message, 'invalid_activity')
  }
  return activity
}

function hasActivityStreamsContext(value: unknown): boolean {
  if (value === ACTIVITYSTREAMS_CONTEXT) return true
  if (Array.isArray(value)) return value.includes(ACTIVITYSTREAMS_CONTEXT)
  return false
}

function extractId(value: unknown): string {
  if (typeof value === 'string') return value
  if (isPlainObject(value)) return asString(value.id) ?? ''
  return ''
}

function extractOptionalId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return extractId(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
