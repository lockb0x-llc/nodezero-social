/**
 * Consentful discovery and relationship v1 contracts.
 *
 * Public discovery fields are deliberately separated from private consent,
 * relationship, moderation, delivery, and replay state.
 */

export const DISCOVERY_CONSENT_KEYS = [
  'publicListing',
  'publicIndexing',
  'nearbyPresence',
  'inboundContactRequests',
  'localBroadcasts',
] as const

export const RELATIONSHIP_STATES = [
  'none',
  'outgoing-pending',
  'incoming-pending',
  'accepted',
  'legacy-connected',
  'rejected',
  'cancelled',
  'disconnected',
] as const

export const RELATIONSHIP_ACTIVITY_TYPES = [
  'Follow',
  'Accept',
  'Reject',
  'Undo',
  'Block',
] as const

export const MODERATION_ACTIONS = ['mute', 'block', 'report'] as const
export const DELIVERY_STATUSES = ['pending', 'delivered', 'failed', 'rejected'] as const

export type DiscoveryConsentKey = (typeof DISCOVERY_CONSENT_KEYS)[number]
export type RelationshipState = (typeof RELATIONSHIP_STATES)[number]
export type RelationshipActivityType = (typeof RELATIONSHIP_ACTIVITY_TYPES)[number]
export type ModerationAction = (typeof MODERATION_ACTIONS)[number]
export type SocialDeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export interface ConsentContractValidationIssue {
  field: string
  message: string
}

export interface DiscoveryConsent {
  version: 1
  ownerWebId: string
  publicListing: boolean
  publicIndexing: boolean
  nearbyPresence: boolean
  inboundContactRequests: boolean
  localBroadcasts: boolean
  updatedAt: string
}

export interface DiscoveryManifest {
  version: 1
  webId: string
  publishedAt: string
  expiresAt: string
  displayName?: string
  avatarUrl?: string
  publicInterests?: string[]
  capabilities?: string[]
  inboxUrl?: string
}

export interface RelationshipActivity {
  version: 1
  id: string
  type: RelationshipActivityType
  actor: string
  object: string
  publishedAt: string
  inReplyTo?: string
}

export interface RelationshipRecord {
  version: 1
  ownerWebId: string
  peerWebId: string
  state: RelationshipState
  updatedAt: string
  activityId?: string
}

export interface ModerationRecord {
  version: 1
  ownerWebId: string
  subjectWebId: string
  action: ModerationAction
  createdAt: string
  reasonCode?: string
}

export interface DeliveryReceipt {
  version: 1
  activityId: string
  senderWebId: string
  recipientWebId: string
  status: SocialDeliveryStatus
  updatedAt: string
  errorCode?: string
}

export interface ProcessedActivityRecord {
  version: 1
  activityId: string
  actorWebId: string
  processedAt: string
  expiresAt: string
}

const RELATIONSHIP_TRANSITIONS: Readonly<Record<RelationshipState, readonly RelationshipState[]>> = {
  none: ['outgoing-pending', 'incoming-pending', 'legacy-connected'],
  'outgoing-pending': ['accepted', 'rejected', 'cancelled'],
  'incoming-pending': ['accepted', 'rejected', 'cancelled'],
  accepted: ['disconnected'],
  'legacy-connected': ['accepted', 'disconnected'],
  rejected: ['outgoing-pending', 'incoming-pending'],
  cancelled: ['outgoing-pending', 'incoming-pending'],
  disconnected: ['outgoing-pending', 'incoming-pending'],
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isWebId(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hash.length > 1
  } catch {
    return false
  }
}

function isIsoDate(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
}

function hasUniqueNonBlankValues(values: string[] | undefined): boolean {
  if (values === undefined) return true
  if (!Array.isArray(values)) return false
  const normalized = values.map((value) => value.trim()).filter(Boolean)
  return normalized.length === values.length && new Set(normalized).size === normalized.length
}

function assertNoIssues(label: string, issues: ConsentContractValidationIssue[]): void {
  if (issues.length === 0) return
  const details = issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')
  throw new Error(`${label} contract validation failed: ${details}`)
}

export function createDefaultDiscoveryConsent(ownerWebId: string, updatedAt: string): DiscoveryConsent {
  return {
    version: 1,
    ownerWebId,
    publicListing: false,
    publicIndexing: false,
    nearbyPresence: false,
    inboundContactRequests: false,
    localBroadcasts: false,
    updatedAt,
  }
}

export function validateDiscoveryConsent(consent: DiscoveryConsent): ConsentContractValidationIssue[] {
  const issues: ConsentContractValidationIssue[] = []
  if (consent.version !== 1) issues.push({ field: 'version', message: 'version must be 1' })
  if (!isWebId(consent.ownerWebId)) issues.push({ field: 'ownerWebId', message: 'ownerWebId must be an https WebID with a fragment' })
  for (const key of DISCOVERY_CONSENT_KEYS) {
    if (typeof consent[key] !== 'boolean') issues.push({ field: key, message: `${key} must be a boolean` })
  }
  if (!isIsoDate(consent.updatedAt)) issues.push({ field: 'updatedAt', message: 'updatedAt must be an ISO-compatible timestamp' })
  return issues
}

export function assertValidDiscoveryConsent(consent: DiscoveryConsent): void {
  assertNoIssues('Discovery consent', validateDiscoveryConsent(consent))
}

export function validateDiscoveryManifest(manifest: DiscoveryManifest): ConsentContractValidationIssue[] {
  const issues: ConsentContractValidationIssue[] = []
  if (manifest.version !== 1) issues.push({ field: 'version', message: 'version must be 1' })
  if (!isWebId(manifest.webId)) issues.push({ field: 'webId', message: 'webId must be an https WebID with a fragment' })
  if (!isIsoDate(manifest.publishedAt)) issues.push({ field: 'publishedAt', message: 'publishedAt must be an ISO-compatible timestamp' })
  if (!isIsoDate(manifest.expiresAt)) issues.push({ field: 'expiresAt', message: 'expiresAt must be an ISO-compatible timestamp' })
  if (isIsoDate(manifest.publishedAt) && isIsoDate(manifest.expiresAt) && Date.parse(manifest.expiresAt) <= Date.parse(manifest.publishedAt)) {
    issues.push({ field: 'expiresAt', message: 'expiresAt must be later than publishedAt' })
  }
  if (manifest.displayName !== undefined && !manifest.displayName.trim()) issues.push({ field: 'displayName', message: 'displayName cannot be blank' })
  if (manifest.avatarUrl !== undefined && !isHttpsUrl(manifest.avatarUrl)) issues.push({ field: 'avatarUrl', message: 'avatarUrl must be an absolute https URL' })
  if (manifest.inboxUrl !== undefined && !isHttpsUrl(manifest.inboxUrl)) issues.push({ field: 'inboxUrl', message: 'inboxUrl must be an absolute https URL' })
  if (!hasUniqueNonBlankValues(manifest.publicInterests)) issues.push({ field: 'publicInterests', message: 'publicInterests must contain unique non-blank strings' })
  if (!hasUniqueNonBlankValues(manifest.capabilities)) issues.push({ field: 'capabilities', message: 'capabilities must contain unique non-blank strings' })
  return issues
}

export function assertValidDiscoveryManifest(manifest: DiscoveryManifest): void {
  assertNoIssues('Discovery manifest', validateDiscoveryManifest(manifest))
}

export function validateRelationshipActivity(activity: RelationshipActivity): ConsentContractValidationIssue[] {
  const issues: ConsentContractValidationIssue[] = []
  if (activity.version !== 1) issues.push({ field: 'version', message: 'version must be 1' })
  if (!isHttpsUrl(activity.id)) issues.push({ field: 'id', message: 'id must be an absolute https URL' })
  if (!RELATIONSHIP_ACTIVITY_TYPES.includes(activity.type)) issues.push({ field: 'type', message: 'type is unsupported' })
  if (!isWebId(activity.actor)) issues.push({ field: 'actor', message: 'actor must be an https WebID with a fragment' })
  if (!isWebId(activity.object) && !isHttpsUrl(activity.object)) issues.push({ field: 'object', message: 'object must be an absolute https URL' })
  if (!isIsoDate(activity.publishedAt)) issues.push({ field: 'publishedAt', message: 'publishedAt must be an ISO-compatible timestamp' })
  if ((activity.type === 'Accept' || activity.type === 'Reject' || activity.type === 'Undo') && !activity.inReplyTo) {
    issues.push({ field: 'inReplyTo', message: `${activity.type} must reference the activity it answers or undoes` })
  }
  if (activity.inReplyTo !== undefined && !isHttpsUrl(activity.inReplyTo)) issues.push({ field: 'inReplyTo', message: 'inReplyTo must be an absolute https URL' })
  return issues
}

export function assertValidRelationshipActivity(activity: RelationshipActivity): void {
  assertNoIssues('Relationship activity', validateRelationshipActivity(activity))
}

export function validateRelationshipRecord(record: RelationshipRecord): ConsentContractValidationIssue[] {
  const issues: ConsentContractValidationIssue[] = []
  if (record.version !== 1) issues.push({ field: 'version', message: 'version must be 1' })
  if (!isWebId(record.ownerWebId)) issues.push({ field: 'ownerWebId', message: 'ownerWebId must be an https WebID with a fragment' })
  if (!isWebId(record.peerWebId)) issues.push({ field: 'peerWebId', message: 'peerWebId must be an https WebID with a fragment' })
  if (record.ownerWebId === record.peerWebId) issues.push({ field: 'peerWebId', message: 'peerWebId must differ from ownerWebId' })
  if (!RELATIONSHIP_STATES.includes(record.state)) issues.push({ field: 'state', message: 'state is unsupported' })
  if (!isIsoDate(record.updatedAt)) issues.push({ field: 'updatedAt', message: 'updatedAt must be an ISO-compatible timestamp' })
  if (record.activityId !== undefined && !isHttpsUrl(record.activityId)) issues.push({ field: 'activityId', message: 'activityId must be an absolute https URL' })
  return issues
}

export function assertValidRelationshipRecord(record: RelationshipRecord): void {
  assertNoIssues('Relationship record', validateRelationshipRecord(record))
}

export function canTransitionRelationship(from: RelationshipState, to: RelationshipState): boolean {
  return from === to || RELATIONSHIP_TRANSITIONS[from].includes(to)
}

export function validateModerationRecord(record: ModerationRecord): ConsentContractValidationIssue[] {
  const issues: ConsentContractValidationIssue[] = []
  if (record.version !== 1) issues.push({ field: 'version', message: 'version must be 1' })
  if (!isWebId(record.ownerWebId)) issues.push({ field: 'ownerWebId', message: 'ownerWebId must be an https WebID with a fragment' })
  if (!isWebId(record.subjectWebId)) issues.push({ field: 'subjectWebId', message: 'subjectWebId must be an https WebID with a fragment' })
  if (record.ownerWebId === record.subjectWebId) issues.push({ field: 'subjectWebId', message: 'subjectWebId must differ from ownerWebId' })
  if (!MODERATION_ACTIONS.includes(record.action)) issues.push({ field: 'action', message: 'action is unsupported' })
  if (!isIsoDate(record.createdAt)) issues.push({ field: 'createdAt', message: 'createdAt must be an ISO-compatible timestamp' })
  if (record.reasonCode !== undefined && !record.reasonCode.trim()) issues.push({ field: 'reasonCode', message: 'reasonCode cannot be blank' })
  return issues
}

export function assertValidModerationRecord(record: ModerationRecord): void {
  assertNoIssues('Moderation record', validateModerationRecord(record))
}

export function validateDeliveryReceipt(receipt: DeliveryReceipt): ConsentContractValidationIssue[] {
  const issues: ConsentContractValidationIssue[] = []
  if (receipt.version !== 1) issues.push({ field: 'version', message: 'version must be 1' })
  if (!isHttpsUrl(receipt.activityId)) issues.push({ field: 'activityId', message: 'activityId must be an absolute https URL' })
  if (!isWebId(receipt.senderWebId)) issues.push({ field: 'senderWebId', message: 'senderWebId must be an https WebID with a fragment' })
  if (!isWebId(receipt.recipientWebId)) issues.push({ field: 'recipientWebId', message: 'recipientWebId must be an https WebID with a fragment' })
  if (!DELIVERY_STATUSES.includes(receipt.status)) issues.push({ field: 'status', message: 'status is unsupported' })
  if (!isIsoDate(receipt.updatedAt)) issues.push({ field: 'updatedAt', message: 'updatedAt must be an ISO-compatible timestamp' })
  if (receipt.errorCode !== undefined && !receipt.errorCode.trim()) issues.push({ field: 'errorCode', message: 'errorCode cannot be blank' })
  return issues
}

export function assertValidDeliveryReceipt(receipt: DeliveryReceipt): void {
  assertNoIssues('Delivery receipt', validateDeliveryReceipt(receipt))
}

export function validateProcessedActivityRecord(record: ProcessedActivityRecord): ConsentContractValidationIssue[] {
  const issues: ConsentContractValidationIssue[] = []
  if (record.version !== 1) issues.push({ field: 'version', message: 'version must be 1' })
  if (!isHttpsUrl(record.activityId)) issues.push({ field: 'activityId', message: 'activityId must be an absolute https URL' })
  if (!isWebId(record.actorWebId)) issues.push({ field: 'actorWebId', message: 'actorWebId must be an https WebID with a fragment' })
  if (!isIsoDate(record.processedAt)) issues.push({ field: 'processedAt', message: 'processedAt must be an ISO-compatible timestamp' })
  if (!isIsoDate(record.expiresAt)) issues.push({ field: 'expiresAt', message: 'expiresAt must be an ISO-compatible timestamp' })
  if (isIsoDate(record.processedAt) && isIsoDate(record.expiresAt) && Date.parse(record.expiresAt) <= Date.parse(record.processedAt)) {
    issues.push({ field: 'expiresAt', message: 'expiresAt must be later than processedAt' })
  }
  return issues
}

export function assertValidProcessedActivityRecord(record: ProcessedActivityRecord): void {
  assertNoIssues('Processed activity record', validateProcessedActivityRecord(record))
}
