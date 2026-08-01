import {
  WebIdDiscoveryClient,
  parseRelationshipActivity,
  serializeRelationshipActivity,
  type RelationshipActivity,
  type WebIdDiscoveryResult,
} from '@nodezero/solid-pod-sync'
import type { SessionClaims } from './sessionTokens.js'
import {
  RELATIONSHIP_DELIVERY_ASSERTION_PROPERTY,
  RelationshipDeliveryAssertionManager,
} from './relationshipDeliveryAssertions.js'
import {
  createCredentialFreePublicFetch,
  postPublicResource,
  type PublicResourceDeliveryOptions,
  type PublicResourceFetcherOptions,
} from './publicResourceFetcher.js'

export interface RelationshipDeliveryInput {
  recipientWebId: string
  activity: unknown
}

export interface RelationshipDeliveryResult {
  recipientWebId: string
  inboxUrl: string
  activityId: string
  activityType: RelationshipActivity['type']
  status: number
  location?: string
}

export interface RelationshipDeliveryOptions {
  publicFetch?: typeof globalThis.fetch
  fetchOptions?: PublicResourceFetcherOptions
  postActivity?: typeof postPublicResource
  postOptions?: PublicResourceDeliveryOptions
  assertionManager?: Pick<RelationshipDeliveryAssertionManager, 'issue'>
}

export class RelationshipDeliveryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message)
    this.name = 'RelationshipDeliveryError'
  }
}

export async function deliverRelationshipActivity(
  claims: SessionClaims,
  input: RelationshipDeliveryInput,
  options: RelationshipDeliveryOptions = {}
): Promise<RelationshipDeliveryResult> {
  const recipientWebId = validateRecipientWebId(input.recipientWebId)
  const activity = parseActivity(input.activity)
  if (activity.actor !== claims.sub) {
    throw new RelationshipDeliveryError(
      'Relationship activity actor does not match the authenticated session.',
      403,
      'actor_mismatch'
    )
  }
  if (activity.type === 'Block') {
    throw new RelationshipDeliveryError(
      'Block activities are private local moderation state and are not delivered.',
      400,
      'block_not_delivered'
    )
  }
  if (activity.type === 'Follow' && activity.object !== recipientWebId) {
    throw new RelationshipDeliveryError(
      'Follow activity object must match recipientWebId.',
      400,
      'recipient_mismatch'
    )
  }

  const publicFetch =
    options.publicFetch ?? createCredentialFreePublicFetch(options.fetchOptions)
  const discovery = await discoverRecipient(recipientWebId, publicFetch)
  if (!discovery.inboxUrl) {
    throw new RelationshipDeliveryError(
      'Recipient WebID does not advertise an inbox.',
      422,
      'inbox_unavailable'
    )
  }

  const assertionManager = options.assertionManager ?? new RelationshipDeliveryAssertionManager()
  const serialized = {
    ...serializeRelationshipActivity(activity),
    [RELATIONSHIP_DELIVERY_ASSERTION_PROPERTY]: assertionManager.issue(
      activity,
      recipientWebId
    ),
  }
  const postActivity = options.postActivity ?? postPublicResource
  const response = await postActivity(
    discovery.inboxUrl,
    Buffer.from(JSON.stringify(serialized), 'utf8'),
    'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
    options.postOptions
  )

  const result: RelationshipDeliveryResult = {
    recipientWebId,
    inboxUrl: discovery.inboxUrl,
    activityId: activity.id,
    activityType: activity.type,
    status: response.status,
  }
  if (response.location) result.location = response.location
  return result
}

async function discoverRecipient(
  recipientWebId: string,
  publicFetch: typeof globalThis.fetch
): Promise<WebIdDiscoveryResult> {
  try {
    return await new WebIdDiscoveryClient({ publicFetch }).discover(recipientWebId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recipient WebID discovery failed.'
    throw new RelationshipDeliveryError(message, 502, 'discovery_failed')
  }
}

function parseActivity(payload: unknown): RelationshipActivity {
  try {
    return parseRelationshipActivity(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Relationship activity is invalid.'
    throw new RelationshipDeliveryError(message, 400, 'invalid_activity')
  }
}

function validateRecipientWebId(value: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.hash.length <= 1) throw new Error()
    return parsed.toString()
  } catch {
    throw new RelationshipDeliveryError(
      'recipientWebId must be an absolute https WebID with a fragment.',
      400,
      'invalid_recipient'
    )
  }
}
