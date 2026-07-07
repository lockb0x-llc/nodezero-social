import { createHash, randomUUID } from 'node:crypto'
import type {
  DigestEmail,
  LifecycleEvent,
  NotificationCategory,
  NotificationMessage,
  OrchestratorDependencies,
} from './types.js'

const CATEGORY_BY_EVENT_PREFIX: Array<[prefix: string, category: NotificationCategory]> = [
  ['account.', 'account'],
  ['provision.', 'system'],
  ['security.', 'security'],
  ['social.', 'social'],
  ['mentions.', 'mentions'],
  ['product.', 'product'],
]

function toIso(date: Date): string {
  return date.toISOString()
}

function inferCategory(eventType: string): NotificationCategory {
  for (const [prefix, category] of CATEGORY_BY_EVENT_PREFIX) {
    if (eventType.startsWith(prefix)) return category
  }
  return 'system'
}

function createDedupeKey(webId: string, eventType: string, occurredAt: string): string {
  return createHash('sha256').update(`${webId}|${eventType}|${occurredAt}`).digest('hex')
}

export class NotificationOrchestrator {
  private readonly deps: Required<OrchestratorDependencies>

  constructor(deps: OrchestratorDependencies) {
    this.deps = {
      ...deps,
      now: deps.now ?? (() => new Date()),
    }
  }

  async ingestLifecycleEvent(event: LifecycleEvent): Promise<NotificationMessage | null> {
    if (!event.webId || !event.podUrl) return null

    const preferences = await this.deps.preferencesStore.getPreferences(event.webId, event.podUrl)
    if (!preferences?.channels.email) return null

    const category = inferCategory(event.eventType)
    const categoryEnabled = preferences.categories[category]
    if (categoryEnabled === false) return null

    const message: NotificationMessage = {
      messageId: randomUUID(),
      userWebId: event.webId,
      category,
      occurredAt: event.occurredAt,
      subject: `NodeZero update: ${event.eventType}`,
      body: JSON.stringify(
        {
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          metadata: event.metadata ?? null,
        },
        null,
        2
      ),
      dedupeKey: createDedupeKey(event.webId, event.eventType, event.occurredAt),
      sourceEventId: event.eventId,
    }

    await this.deps.messageStore.append(message)
    return message
  }

  async runDigest(webId: string, windowStart: Date, windowEnd: Date): Promise<DigestEmail | null> {
    const user = await this.deps.userDirectory.resolveByWebId(webId)
    if (!user) return null

    const preferences = await this.deps.preferencesStore.getPreferences(webId, user.podUrl)
    if (!preferences?.channels.email || preferences.digest.cadence === 'off') {
      return null
    }

    const messages = await this.deps.messageStore.listForDigest(webId, toIso(windowStart), toIso(windowEnd))
    if (messages.length === 0) return null

    const digest: DigestEmail = {
      digestId: randomUUID(),
      userWebId: webId,
      windowStart: toIso(windowStart),
      windowEnd: toIso(windowEnd),
      toEmail: user.email,
      subject: `NodeZero digest (${messages.length} updates)`,
      body: messages
        .map((message) => `- [${message.category}] ${message.subject} (${message.occurredAt})`)
        .join('\n'),
      sourceMessageIds: messages.map((message) => message.messageId),
    }

    await this.deps.emailSender.sendDigest(digest)
    return digest
  }

  currentIsoTime(): string {
    return toIso(this.deps.now())
  }
}
