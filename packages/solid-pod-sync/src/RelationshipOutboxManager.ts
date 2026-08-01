import {
  parseRelationshipActivity,
  serializeRelationshipActivity,
} from './adapters/ActivityStreamsRelationshipAdapter.js'
import type { RelationshipActivity } from './contracts/ConsentfulDiscoveryContract.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  deriveOwnerWebId,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface RelationshipOutboxManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
  }
}

export class RelationshipOutboxError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'RelationshipOutboxError'
  }
}

export class RelationshipOutboxManager {
  constructor(
    private readonly session: AuthenticatedSession,
    private readonly options: RelationshipOutboxManagerOptions = {}
  ) {}

  async writeActivity(
    podRoot: string,
    activity: RelationshipActivity
  ): Promise<RelationshipActivity> {
    this.assertOwnerBinding(podRoot, activity)
    await this.ensurePodLayoutIfEnabled(podRoot)
    const response = await this.session.fetch(activity.id, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      },
      body: JSON.stringify(serializeRelationshipActivity(activity)),
    })
    if (!response.ok) {
      throw new RelationshipOutboxError(
        `Unable to persist relationship activity: HTTP ${response.status}`,
        'outbox_write_failed'
      )
    }
    return activity
  }

  async readActivity(podRoot: string, activityId: string): Promise<RelationshipActivity | null> {
    this.assertActivityNamespace(podRoot, activityId)
    const response = await this.session.fetch(activityId, {
      headers: { Accept: 'application/ld+json, application/json' },
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new RelationshipOutboxError(
        `Unable to read relationship activity: HTTP ${response.status}`,
        'outbox_read_failed'
      )
    }
    try {
      return parseRelationshipActivity(await response.json())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outbox activity is invalid.'
      throw new RelationshipOutboxError(message, 'invalid_outbox_activity')
    }
  }

  private assertOwnerBinding(podRoot: string, activity: RelationshipActivity): void {
    this.assertActivityNamespace(podRoot, activity.id)
    const expectedActor = deriveOwnerWebId(`${podRoot.replace(/\/$/, '')}/social/outbox/`)
    if (activity.actor !== expectedActor) {
      throw new RelationshipOutboxError(
        'Relationship activity actor does not match the Pod owner.',
        'actor_owner_mismatch'
      )
    }
  }

  private assertActivityNamespace(podRoot: string, activityId: string): void {
    const outboxRoot = `${podRoot.replace(/\/$/, '')}/social/outbox/`
    let activityUrl: URL
    try {
      activityUrl = new URL(activityId)
    } catch {
      throw new RelationshipOutboxError('Activity ID must be an absolute URL.', 'invalid_activity_id')
    }
    if (!activityUrl.href.startsWith(outboxRoot) || activityUrl.href === outboxRoot) {
      throw new RelationshipOutboxError(
        'Activity ID must remain inside the owner relationship outbox.',
        'activity_outside_outbox'
      )
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

export const RELATIONSHIP_OUTBOX_PATH = 'social/outbox/'
