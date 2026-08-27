/**
 * @module solid-pod-sync
 *
 * NodeZero Solid Protocol integration layer.
 * Provides authentication, profile management, and social graph operations
 * against user-owned Solid Pods (https://solidproject.org/).
 *
 * Design principles:
 * - NodeZero is a CLIENT, never a data silo. All user data lives in Solid Pods.
 * - NSFW detection is automatic, transparent, and never punitive – it only adds
 *   metadata so UIs can make informed rendering choices.
 * - No engagement-farming algorithms. All data access is explicit and consent-based.
 */

export { ProfileManager } from './ProfileManager.js'
export { ProfilePreferencesManager } from './ProfilePreferencesManager.js'
export { SocialGraph } from './SocialGraph.js'
export { NsfwScanner, NSFW_DOMAINS } from './NsfwScanner.js'
export {
	collectNsfwScanUrls,
	hasNsfwSignals,
	deriveProfileNsfwFlag,
} from './NsfwDecision.js'
export { DocustreamManager } from './DocustreamManager.js'
export { DocustreamSourceManager } from './DocustreamSourceManager.js'
export { NotificationManager } from './NotificationManager.js'
export {
	DiscoveryManifestManager,
	DISCOVERY_MANIFEST_DATASET_PATH,
} from './DiscoveryManifestManager.js'
export {
	RelationshipManager,
	RELATIONSHIPS_DATASET_PATH,
} from './RelationshipManager.js'
export {
	ModerationManager,
	MODERATION_DATASET_PATH,
} from './ModerationManager.js'
export {
	PublicTypeIndexManager,
	DISCOVERY_MANIFEST_CLASS,
} from './PublicTypeIndexManager.js'
export {
	WebIdDiscoveryClient,
	parseLinkHeader,
} from './WebIdDiscoveryClient.js'
export {
	ProcessedActivityManager,
	PROCESSED_ACTIVITIES_DATASET_PATH,
} from './ProcessedActivityManager.js'
export {
	RelationshipInboxProcessor,
	RelationshipInboxError,
} from './RelationshipInboxProcessor.js'
export { RelationshipFoafProjector } from './RelationshipFoafProjector.js'
export {
	DeliveryReceiptManager,
	DELIVERY_RECEIPTS_DATASET_PATH,
} from './DeliveryReceiptManager.js'
export { LegacyRelationshipMigrator } from './LegacyRelationshipMigrator.js'
export {
	RelationshipOutboxManager,
	RelationshipOutboxError,
	RELATIONSHIP_OUTBOX_PATH,
} from './RelationshipOutboxManager.js'
export {
	RelationshipQuarantineManager,
	RELATIONSHIP_QUARANTINE_DATASET_PATH,
} from './RelationshipQuarantineManager.js'
export { RelationshipInboxIngestion } from './RelationshipInboxIngestion.js'
export {
	DiscoveryConsentManager,
	DISCOVERY_CONSENT_DATASET_PATH,
} from './DiscoveryConsentManager.js'
export {
	RelationshipInboxReader,
	RelationshipInboxReaderError,
	RELATIONSHIP_INBOX_PATH,
} from './RelationshipInboxReader.js'
export {
	OutboxDeliveryWorker,
	OutboxDeliveryError,
	createProvisionerActivityDeliverer,
} from './OutboxDeliveryWorker.js'
export { createSolidPodSyncManagers } from './createSolidPodSyncManagers.js'
export { mergeAndQueryActivities } from './DocustreamAggregation.js'
export { buildQueryIndex, queryStreamItems } from './QueryApi.js'
export {
	createSyncState,
	buildSyncEventId,
	applySyncBatch,
	serializeSyncState,
	deserializeSyncState,
} from './SyncEngine.js'
export {
	PodLayoutManager,
	buildPodContainerLayout,
	buildAclDocument,
	deriveOwnerWebId,
	DEFAULT_POLICY_MATRIX,
} from './PodLayoutManager.js'
export {
	createMashlibWebAdapter,
	inferMashlibResourceType,
} from './adapters/MashlibWebAdapter.js'
export {
	ACTIVITYSTREAMS_CONTEXT,
	ActivityStreamsRelationshipError,
	serializeRelationshipActivity,
	parseRelationshipActivity,
} from './adapters/ActivityStreamsRelationshipAdapter.js'
export {
	DOCUSTREAM_ALLOWED_SOURCES,
	assertValidStreamItem,
	validateStreamItem,
} from './contracts/DocustreamContract.js'
export {
	DOCUSTREAM_SOURCE_TYPES,
	assertValidDocustreamSource,
	validateDocustreamSource,
} from './contracts/DocustreamSourceContract.js'
export {
	NOTIFICATION_CATEGORIES,
	DIGEST_CADENCES,
	DELIVERY_STATUSES,
	EVENT_PRIORITIES,
	assertValidNotificationPreferences,
	validateNotificationPreferences,
	assertValidNotificationEvent,
	validateNotificationEvent,
	assertValidDigestManifest,
	validateDigestManifest,
} from './contracts/NotificationContract.js'
export {
	assertValidPublicProfileDocument,
	validatePublicProfileDocument,
	assertValidPrivateProfilePreferencesDocument,
	validatePrivateProfilePreferencesDocument,
	assertValidDataBackpackProfile,
	validateDataBackpackProfile,
} from './contracts/DataBackpackContract.js'
export {
	assertValidConnectionRecord,
	validateConnectionRecord,
} from './contracts/SocialGraphContract.js'
export {
	DISCOVERY_CONSENT_KEYS,
	RELATIONSHIP_STATES,
	RELATIONSHIP_ACTIVITY_TYPES,
	MODERATION_ACTIONS,
	DELIVERY_STATUSES as SOCIAL_DELIVERY_STATUSES,
	createDefaultDiscoveryConsent,
	validateDiscoveryConsent,
	assertValidDiscoveryConsent,
	validateDiscoveryManifest,
	assertValidDiscoveryManifest,
	validateRelationshipActivity,
	assertValidRelationshipActivity,
	validateRelationshipRecord,
	assertValidRelationshipRecord,
	canTransitionRelationship,
	validateModerationRecord,
	assertValidModerationRecord,
	validateDeliveryReceipt,
	assertValidDeliveryReceipt,
	validateProcessedActivityRecord,
	assertValidProcessedActivityRecord,
} from './contracts/ConsentfulDiscoveryContract.js'
export type { UserProfile, ProfileWriteOptions } from './ProfileManager.js'
export type {
	ProfilePreferencesManagerOptions,
	ProfilePreferencesWriteOptions,
} from './ProfilePreferencesManager.js'
export type { Connection } from './SocialGraph.js'
export type { NsfwScanResult } from './NsfwScanner.js'
export type { NsfwUrlSource, NsfwDecisionOptions } from './NsfwDecision.js'
export type { StreamItem } from './DocustreamManager.js'
export type { DocustreamManagerOptions } from './DocustreamManager.js'
export type {
	DocustreamSource,
	DocustreamSourceType,
	SourceValidationIssue,
} from './contracts/DocustreamSourceContract.js'
export type {
	DocustreamSourceManagerOptions,
	UpsertDocustreamSourceInput,
} from './DocustreamSourceManager.js'
export type {
	NotificationManagerOptions,
	NotificationHistoryRecord,
	NotificationPreferencesPatch,
} from './NotificationManager.js'
export type { DiscoveryManifestManagerOptions } from './DiscoveryManifestManager.js'
export type {
	RelationshipManagerOptions,
	RelationshipTransitionInput,
} from './RelationshipManager.js'
export type {
	ModerationManagerOptions,
	SetModerationInput,
} from './ModerationManager.js'
export type { PublicTypeRegistration } from './PublicTypeIndexManager.js'
export type {
	WebIdDiscoveryResult,
	WebIdDiscoveryClientOptions,
} from './WebIdDiscoveryClient.js'
export type { ProcessedActivityManagerOptions } from './ProcessedActivityManager.js'
export type {
	RelationshipInboxProcessorOptions,
	ProcessRelationshipInboxInput,
	RelationshipInboxResult,
} from './RelationshipInboxProcessor.js'
export type { RelationshipFoafProjectionResult } from './RelationshipFoafProjector.js'
export type { DeliveryReceiptManagerOptions } from './DeliveryReceiptManager.js'
export type { LegacyRelationshipMigrationResult } from './LegacyRelationshipMigrator.js'
export type { RelationshipOutboxManagerOptions } from './RelationshipOutboxManager.js'
export type {
	RelationshipQuarantineManagerOptions,
	QuarantinedRelationshipActivity,
} from './RelationshipQuarantineManager.js'
export type {
	RelationshipSenderVerifier,
	IngestRelationshipActivityInput,
	RelationshipInboxIngestionResult,
} from './RelationshipInboxIngestion.js'
export type {
	DiscoveryConsentManagerOptions,
	DiscoveryConsentPatch,
} from './DiscoveryConsentManager.js'
export type {
	RelationshipInboxReaderOptions,
	RelationshipInboxResource,
} from './RelationshipInboxReader.js'
export type {
	OutboxDeliveryWorkerOptions,
	OutboxDeliveryItemResult,
	OutboxDeliveryBatchResult,
	ActivityDeliverer,
	ActivityDelivererResult,
} from './OutboxDeliveryWorker.js'
export type { ProfileManagerOptions } from './ProfileManager.js'
export type { SocialGraphOptions } from './SocialGraph.js'
export type { ContractValidationIssue, StreamSource } from './contracts/DocustreamContract.js'
export type { DataBackpackProfile } from './contracts/DataBackpackContract.js'
export type {
	PublicProfileDocument,
	PrivateProfilePreferencesDocument,
} from './contracts/DataBackpackContract.js'
export type { ConnectionRecord } from './contracts/SocialGraphContract.js'
export type {
	DiscoveryConsentKey,
	RelationshipState,
	RelationshipActivityType,
	ModerationAction,
	SocialDeliveryStatus,
	ConsentContractValidationIssue,
	DiscoveryConsent,
	DiscoveryManifest,
	RelationshipActivity,
	RelationshipRecord,
	ModerationRecord,
	DeliveryReceipt,
	ProcessedActivityRecord,
} from './contracts/ConsentfulDiscoveryContract.js'
export type {
	NotificationCategory,
	DigestCadence,
	DeliveryStatus,
	NotificationPriority,
	NotificationPreferences,
	NotificationEvent,
	DigestManifest,
} from './contracts/NotificationContract.js'
export type {
	SolidPodSyncManagers,
	SolidPodSyncFactoryOptions,
} from './createSolidPodSyncManagers.js'
export type {
	ActivitySourceBatch,
	EnrichedStreamItem,
	MergeAndQueryOptions,
	MergeAndQueryResult,
} from './DocustreamAggregation.js'
export type {
	QueryableStreamItem,
	QueryAudience,
	StreamQuery,
	QueryIndex,
} from './QueryApi.js'
export type {
	SyncEnvelope,
	SyncState,
	SyncBatchResult,
	SerializedSyncState,
} from './SyncEngine.js'
export type {
	PodContainerLayout,
	PodPolicyMatrix,
	ContainerVisibility,
} from './PodLayoutManager.js'
export type {
	MashlibPaneDescriptor,
	MashlibResourceBinding,
	MashlibResourceType,
	MashlibWebAdapter,
	MashlibWebAdapterOptions,
} from './adapters/MashlibWebAdapter.js'
export type { ActivityStreamsRelationshipDocument } from './adapters/ActivityStreamsRelationshipAdapter.js'
