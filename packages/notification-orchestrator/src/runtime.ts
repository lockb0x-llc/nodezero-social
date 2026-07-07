import type {
  DigestEmail,
  EmailSender,
  MessageStore,
  NotificationMessage,
  NotificationPreferences,
  PreferencesStore,
  UserDirectory,
  UserDirectoryRecord,
} from './types.js'

function parseUserDirectory(raw: string): Record<string, UserDirectoryRecord> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, UserDirectoryRecord>
    return parsed ?? {}
  } catch {
    return {}
  }
}

export function defaultPreferences(): NotificationPreferences {
  return {
    channels: { email: true },
    digest: { cadence: 'daily', timezone: 'UTC' },
    categories: {
      security: true,
      account: true,
      social: true,
      mentions: true,
      system: true,
      product: true,
    },
  }
}

export class InMemoryPreferencesStore implements PreferencesStore {
  constructor(
    private readonly records: Record<string, NotificationPreferences> = {},
    private readonly fallback: NotificationPreferences = defaultPreferences()
  ) {}

  async getPreferences(webId: string): Promise<NotificationPreferences | null> {
    return this.records[webId] ?? this.fallback
  }
}

export class InMemoryMessageStore implements MessageStore {
  private readonly messages: NotificationMessage[] = []

  async append(message: NotificationMessage): Promise<void> {
    this.messages.push(message)
  }

  async listForDigest(webId: string, windowStart: string, windowEnd: string): Promise<NotificationMessage[]> {
    return this.messages.filter(
      (message) =>
        message.userWebId === webId &&
        message.occurredAt >= windowStart &&
        message.occurredAt <= windowEnd
    )
  }

  size(): number {
    return this.messages.length
  }
}

export class InMemoryUserDirectory implements UserDirectory {
  constructor(private readonly records: Record<string, UserDirectoryRecord>) {}

  static fromEnv(raw: string | undefined): InMemoryUserDirectory {
    return new InMemoryUserDirectory(parseUserDirectory(raw ?? ''))
  }

  async resolveByWebId(webId: string): Promise<UserDirectoryRecord | null> {
    return this.records[webId] ?? null
  }
}

export class ConsoleEmailSender implements EmailSender {
  async sendDigest(email: DigestEmail): Promise<{ providerMessageId?: string }> {
    console.log('[notification-orchestrator:digest]', JSON.stringify(email))
    return { providerMessageId: `console-${email.digestId}` }
  }
}
