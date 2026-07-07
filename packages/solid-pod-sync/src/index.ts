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
export { SocialGraph } from './SocialGraph.js'
export { NsfwScanner, NSFW_DOMAINS } from './NsfwScanner.js'
export { DocustreamManager } from './DocustreamManager.js'
export { DocustreamSourceManager } from './DocustreamSourceManager.js'
export { NotificationManager } from './NotificationManager.js'
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
	assertValidDataBackpackProfile,
	validateDataBackpackProfile,
} from './contracts/DataBackpackContract.js'
export {
	assertValidConnectionRecord,
	validateConnectionRecord,
} from './contracts/SocialGraphContract.js'
export type { UserProfile, ProfileWriteOptions } from './ProfileManager.js'
export type { Connection } from './SocialGraph.js'
export type { NsfwScanResult } from './NsfwScanner.js'
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
export type { ProfileManagerOptions } from './ProfileManager.js'
export type { SocialGraphOptions } from './SocialGraph.js'
export type { ContractValidationIssue, StreamSource } from './contracts/DocustreamContract.js'
export type { DataBackpackProfile } from './contracts/DataBackpackContract.js'
export type { ConnectionRecord } from './contracts/SocialGraphContract.js'
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
