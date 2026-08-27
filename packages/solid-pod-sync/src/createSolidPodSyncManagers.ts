import { DocustreamManager, type DocustreamManagerOptions } from './DocustreamManager.js'
import {
  DocustreamSourceManager,
  type DocustreamSourceManagerOptions,
} from './DocustreamSourceManager.js'
import { ProfileManager, type ProfileManagerOptions } from './ProfileManager.js'
import {
  ProfilePreferencesManager,
  type ProfilePreferencesManagerOptions,
} from './ProfilePreferencesManager.js'
import { SocialGraph, type SocialGraphOptions } from './SocialGraph.js'
import { NsfwScanner } from './NsfwScanner.js'
import { NotificationManager, type NotificationManagerOptions } from './NotificationManager.js'
import {
  DiscoveryManifestManager,
  type DiscoveryManifestManagerOptions,
} from './DiscoveryManifestManager.js'
import { RelationshipManager, type RelationshipManagerOptions } from './RelationshipManager.js'
import { ModerationManager, type ModerationManagerOptions } from './ModerationManager.js'
import { PublicTypeIndexManager } from './PublicTypeIndexManager.js'
import {
  ProcessedActivityManager,
  type ProcessedActivityManagerOptions,
} from './ProcessedActivityManager.js'
import { RelationshipInboxProcessor } from './RelationshipInboxProcessor.js'
import { RelationshipFoafProjector } from './RelationshipFoafProjector.js'
import {
  DeliveryReceiptManager,
  type DeliveryReceiptManagerOptions,
} from './DeliveryReceiptManager.js'
import { LegacyRelationshipMigrator } from './LegacyRelationshipMigrator.js'
import {
  RelationshipOutboxManager,
  type RelationshipOutboxManagerOptions,
} from './RelationshipOutboxManager.js'
import {
  RelationshipQuarantineManager,
  type RelationshipQuarantineManagerOptions,
} from './RelationshipQuarantineManager.js'
import {
  DiscoveryConsentManager,
  type DiscoveryConsentManagerOptions,
} from './DiscoveryConsentManager.js'
import { RelationshipInboxReader } from './RelationshipInboxReader.js'
import {
  OutboxDeliveryWorker,
  type OutboxDeliveryWorkerOptions,
} from './OutboxDeliveryWorker.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface SolidPodSyncManagers {
  profileManager: ProfileManager
  profilePreferencesManager: ProfilePreferencesManager
  socialGraph: SocialGraph
  docustreamManager: DocustreamManager
  docustreamSourceManager: DocustreamSourceManager
  notificationManager: NotificationManager
  discoveryManifestManager: DiscoveryManifestManager
  relationshipManager: RelationshipManager
  moderationManager: ModerationManager
  publicTypeIndexManager: PublicTypeIndexManager
  processedActivityManager: ProcessedActivityManager
  relationshipInboxProcessor: RelationshipInboxProcessor
  relationshipFoafProjector: RelationshipFoafProjector
  deliveryReceiptManager: DeliveryReceiptManager
  legacyRelationshipMigrator: LegacyRelationshipMigrator
  relationshipOutboxManager: RelationshipOutboxManager
  relationshipQuarantineManager: RelationshipQuarantineManager
  discoveryConsentManager: DiscoveryConsentManager
  relationshipInboxReader: RelationshipInboxReader
  outboxDeliveryWorker: OutboxDeliveryWorker
  podLayoutManager: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
    ensureDocustreamLayoutAndPolicy?: PodLayoutManager['ensureDocustreamLayoutAndPolicy']
  }
}

export interface SolidPodSyncFactoryOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
    ensureDocustreamLayoutAndPolicy?: PodLayoutManager['ensureDocustreamLayoutAndPolicy']
  }
  nsfwScanner?: NsfwScanner
  outboxDeliveryWorkerOptions?: OutboxDeliveryWorkerOptions
}

export function createSolidPodSyncManagers(
  session: AuthenticatedSession,
  options: SolidPodSyncFactoryOptions = {}
): SolidPodSyncManagers {
  const podLayoutManager =
    options.podLayoutManager ?? new PodLayoutManager({ fetch: session.fetch })

  const sharedBootstrapOptions: Pick<
    DocustreamManagerOptions &
      ProfileManagerOptions &
      SocialGraphOptions &
      DocustreamSourceManagerOptions &
      NotificationManagerOptions &
      ProfilePreferencesManagerOptions &
      DiscoveryManifestManagerOptions &
      RelationshipManagerOptions &
      ModerationManagerOptions &
      ProcessedActivityManagerOptions &
      DeliveryReceiptManagerOptions &
      RelationshipOutboxManagerOptions &
      RelationshipQuarantineManagerOptions &
      DiscoveryConsentManagerOptions,
    'enablePodBootstrap' | 'policyMatrix' | 'podLayoutManager'
  > = {
    enablePodBootstrap: options.enablePodBootstrap ?? false,
    policyMatrix: options.policyMatrix ?? DEFAULT_POLICY_MATRIX,
    podLayoutManager,
  }

  const relationshipManager = new RelationshipManager(session, sharedBootstrapOptions)
  const processedActivityManager = new ProcessedActivityManager(session, sharedBootstrapOptions)
  const moderationManager = new ModerationManager(session, sharedBootstrapOptions)
  const deliveryReceiptManager = new DeliveryReceiptManager(session, sharedBootstrapOptions)
  const relationshipOutboxManager = new RelationshipOutboxManager(session, sharedBootstrapOptions)

  const socialGraph = new SocialGraph(session, sharedBootstrapOptions)

  const outboxDeliveryWorker = new OutboxDeliveryWorker(
    deliveryReceiptManager,
    relationshipOutboxManager,
    moderationManager,
    options.outboxDeliveryWorkerOptions
  )

  return {
    profileManager: new ProfileManager(
      session,
      options.nsfwScanner,
      sharedBootstrapOptions
    ),
    profilePreferencesManager: new ProfilePreferencesManager(session, sharedBootstrapOptions),
    socialGraph,
    docustreamManager: new DocustreamManager(session, sharedBootstrapOptions),
    docustreamSourceManager: new DocustreamSourceManager(session, sharedBootstrapOptions),
    notificationManager: new NotificationManager(session, sharedBootstrapOptions),
    discoveryManifestManager: new DiscoveryManifestManager(session, sharedBootstrapOptions),
    relationshipManager,
    moderationManager,
    publicTypeIndexManager: new PublicTypeIndexManager(session),
    processedActivityManager,
    relationshipInboxProcessor: new RelationshipInboxProcessor(
      relationshipManager,
      processedActivityManager,
      moderationManager
    ),
    relationshipFoafProjector: new RelationshipFoafProjector(socialGraph),
    deliveryReceiptManager,
    legacyRelationshipMigrator: new LegacyRelationshipMigrator(
      socialGraph,
      relationshipManager
    ),
    relationshipOutboxManager,
    relationshipQuarantineManager: new RelationshipQuarantineManager(
      session,
      sharedBootstrapOptions
    ),
    discoveryConsentManager: new DiscoveryConsentManager(session, sharedBootstrapOptions),
    relationshipInboxReader: new RelationshipInboxReader(session),
    outboxDeliveryWorker,
    podLayoutManager,
  }
}
