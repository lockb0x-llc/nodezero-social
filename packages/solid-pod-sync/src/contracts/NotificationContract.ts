/**
 * Notification contracts for Pod-backed user preferences and digest execution state.
 */

export const NOTIFICATION_CATEGORIES = [
  'security',
  'account',
  'social',
  'mentions',
  'system',
  'product',
] as const

export const DIGEST_CADENCES = ['off', 'daily', 'weekly'] as const
export const DELIVERY_STATUSES = ['queued', 'sent', 'failed'] as const
export const EVENT_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]
export type DigestCadence = (typeof DIGEST_CADENCES)[number]
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]
export type NotificationPriority = (typeof EVENT_PRIORITIES)[number]

export interface ContractValidationIssue {
  field: string
  message: string
}

export interface NotificationPreferences {
  version: 1
  channels: {
    email: boolean
  }
  digest: {
    cadence: DigestCadence
    timezone: string
    quietHours?: {
      start: string
      end: string
    }
  }
  categories: Partial<Record<NotificationCategory, boolean>>
  locale?: string
  updatedAt: string
}

export interface NotificationEvent {
  eventId: string
  type: string
  category: NotificationCategory
  occurredAt: string
  priority?: NotificationPriority
  summary?: string
  dedupeKey?: string
  resourceRefs?: string[]
}

export interface DigestManifest {
  digestId: string
  windowStart: string
  windowEnd: string
  includedEventIds: string[]
  renderedAt: string
  deliveryStatus: DeliveryStatus
  providerMessageId?: string
  channel: 'email'
}

function isIsoTimestamp(value: string): boolean {
  if (!value || Number.isNaN(Date.parse(value))) return false
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)
}

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9._:-]+$/.test(value)
}

function isValidQuietHour(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function validateNotificationPreferences(
  preferences: NotificationPreferences
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = []

  if (preferences.version !== 1) {
    issues.push({ field: 'version', message: 'version must be 1' })
  }

  if (typeof preferences.channels?.email !== 'boolean') {
    issues.push({ field: 'channels.email', message: 'channels.email must be a boolean' })
  }

  if (!DIGEST_CADENCES.includes(preferences.digest?.cadence)) {
    issues.push({ field: 'digest.cadence', message: `digest.cadence must be one of: ${DIGEST_CADENCES.join(', ')}` })
  }

  if (!preferences.digest?.timezone?.trim()) {
    issues.push({ field: 'digest.timezone', message: 'digest.timezone is required' })
  }

  if (preferences.digest?.quietHours) {
    if (!isValidQuietHour(preferences.digest.quietHours.start)) {
      issues.push({ field: 'digest.quietHours.start', message: 'quiet hour start must be HH:MM (24h)' })
    }
    if (!isValidQuietHour(preferences.digest.quietHours.end)) {
      issues.push({ field: 'digest.quietHours.end', message: 'quiet hour end must be HH:MM (24h)' })
    }
  }

  for (const [category, enabled] of Object.entries(preferences.categories ?? {})) {
    if (!NOTIFICATION_CATEGORIES.includes(category as NotificationCategory)) {
      issues.push({ field: `categories.${category}`, message: 'unknown notification category' })
      continue
    }
    if (typeof enabled !== 'boolean') {
      issues.push({ field: `categories.${category}`, message: 'category value must be a boolean' })
    }
  }

  if (!isIsoTimestamp(preferences.updatedAt)) {
    issues.push({ field: 'updatedAt', message: 'updatedAt must be an ISO-8601 UTC string' })
  }

  return issues
}

export function assertValidNotificationPreferences(preferences: NotificationPreferences): void {
  const issues = validateNotificationPreferences(preferences)
  if (issues.length === 0) return

  const details = issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')
  throw new Error(`Notification preferences contract validation failed: ${details}`)
}

export function validateNotificationEvent(event: NotificationEvent): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = []

  if (!event.eventId?.trim()) {
    issues.push({ field: 'eventId', message: 'eventId is required' })
  } else if (!isSafeIdentifier(event.eventId)) {
    issues.push({ field: 'eventId', message: 'eventId contains unsupported characters' })
  }

  if (!event.type?.trim()) {
    issues.push({ field: 'type', message: 'type is required' })
  }

  if (!NOTIFICATION_CATEGORIES.includes(event.category)) {
    issues.push({ field: 'category', message: `category must be one of: ${NOTIFICATION_CATEGORIES.join(', ')}` })
  }

  if (!isIsoTimestamp(event.occurredAt)) {
    issues.push({ field: 'occurredAt', message: 'occurredAt must be an ISO-8601 UTC string' })
  }

  if (event.priority !== undefined && !EVENT_PRIORITIES.includes(event.priority)) {
    issues.push({ field: 'priority', message: `priority must be one of: ${EVENT_PRIORITIES.join(', ')}` })
  }

  if (event.resourceRefs !== undefined && !Array.isArray(event.resourceRefs)) {
    issues.push({ field: 'resourceRefs', message: 'resourceRefs must be an array when provided' })
  }

  return issues
}

export function assertValidNotificationEvent(event: NotificationEvent): void {
  const issues = validateNotificationEvent(event)
  if (issues.length === 0) return

  const details = issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')
  throw new Error(`Notification event contract validation failed: ${details}`)
}

export function validateDigestManifest(manifest: DigestManifest): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = []

  if (!manifest.digestId?.trim()) {
    issues.push({ field: 'digestId', message: 'digestId is required' })
  } else if (!isSafeIdentifier(manifest.digestId)) {
    issues.push({ field: 'digestId', message: 'digestId contains unsupported characters' })
  }

  if (!isIsoTimestamp(manifest.windowStart)) {
    issues.push({ field: 'windowStart', message: 'windowStart must be an ISO-8601 UTC string' })
  }

  if (!isIsoTimestamp(manifest.windowEnd)) {
    issues.push({ field: 'windowEnd', message: 'windowEnd must be an ISO-8601 UTC string' })
  }

  if (!Array.isArray(manifest.includedEventIds)) {
    issues.push({ field: 'includedEventIds', message: 'includedEventIds must be an array' })
  }

  if (!isIsoTimestamp(manifest.renderedAt)) {
    issues.push({ field: 'renderedAt', message: 'renderedAt must be an ISO-8601 UTC string' })
  }

  if (!DELIVERY_STATUSES.includes(manifest.deliveryStatus)) {
    issues.push({ field: 'deliveryStatus', message: `deliveryStatus must be one of: ${DELIVERY_STATUSES.join(', ')}` })
  }

  if (manifest.channel !== 'email') {
    issues.push({ field: 'channel', message: 'channel must be email' })
  }

  return issues
}

export function assertValidDigestManifest(manifest: DigestManifest): void {
  const issues = validateDigestManifest(manifest)
  if (issues.length === 0) return

  const details = issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')
  throw new Error(`Digest manifest contract validation failed: ${details}`)
}
