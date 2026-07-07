export type NotificationCategory =
  | 'security'
  | 'account'
  | 'social'
  | 'mentions'
  | 'system'
  | 'product'

export type DigestCadence = 'off' | 'daily' | 'weekly'

export interface NotificationPreferences {
  channels: {
    email: boolean
  }
  digest: {
    cadence: DigestCadence
    timezone: string
  }
  categories: Partial<Record<NotificationCategory, boolean>>
  quietHours?: {
    start: string
    end: string
  }
}

export interface LifecycleEvent {
  eventId: string
  eventType: string
  occurredAt: string
  envProfile: string
  issuer: string
  webId?: string
  podUrl?: string
  metadata?: Record<string, unknown>
}

export interface NotificationMessage {
  messageId: string
  userWebId: string
  category: NotificationCategory
  occurredAt: string
  subject: string
  body: string
  dedupeKey: string
  sourceEventId: string
}

export interface DigestEmail {
  digestId: string
  userWebId: string
  windowStart: string
  windowEnd: string
  toEmail: string
  subject: string
  body: string
  sourceMessageIds: string[]
}

export interface UserDirectoryRecord {
  webId: string
  email: string
  podUrl: string
}

export interface PreferencesStore {
  getPreferences(webId: string, podUrl: string): Promise<NotificationPreferences | null>
}

export interface MessageStore {
  append(message: NotificationMessage): Promise<void>
  listForDigest(webId: string, windowStart: string, windowEnd: string): Promise<NotificationMessage[]>
}

export interface EmailSender {
  sendDigest(email: DigestEmail): Promise<{ providerMessageId?: string }>
}

export interface UserDirectory {
  resolveByWebId(webId: string): Promise<UserDirectoryRecord | null>
}

export interface OrchestratorDependencies {
  preferencesStore: PreferencesStore
  messageStore: MessageStore
  emailSender: EmailSender
  userDirectory: UserDirectory
  now?: () => Date
}
