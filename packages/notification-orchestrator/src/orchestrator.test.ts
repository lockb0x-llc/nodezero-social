import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { NotificationOrchestrator } from './orchestrator.js'
import type {
  DigestEmail,
  LifecycleEvent,
  NotificationMessage,
  NotificationPreferences,
  UserDirectoryRecord,
} from './types.js'

class InMemoryPreferencesStore {
  constructor(private readonly records: Record<string, NotificationPreferences>) {}

  async getPreferences(webId: string): Promise<NotificationPreferences | null> {
    return this.records[webId] ?? null
  }
}

class InMemoryMessageStore {
  readonly messages: NotificationMessage[] = []

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
}

class InMemoryEmailSender {
  readonly digests: DigestEmail[] = []

  async sendDigest(email: DigestEmail): Promise<{ providerMessageId?: string }> {
    this.digests.push(email)
    return { providerMessageId: 'provider-1' }
  }
}

class InMemoryUserDirectory {
  constructor(private readonly records: Record<string, UserDirectoryRecord>) {}

  async resolveByWebId(webId: string): Promise<UserDirectoryRecord | null> {
    return this.records[webId] ?? null
  }
}

const WEB_ID = 'https://solid.nodezero.social/alice/profile/card#me'
const POD_URL = 'https://solid.nodezero.social/alice/'

function defaultPreferences(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    channels: { email: true },
    digest: { cadence: 'daily', timezone: 'UTC' },
    categories: {
      account: true,
      social: true,
      security: true,
      system: true,
      mentions: true,
      product: true,
    },
    ...overrides,
  }
}

void test('ingestLifecycleEvent stores message when category is enabled', async () => {
  const messageStore = new InMemoryMessageStore()
  const orchestrator = new NotificationOrchestrator({
    preferencesStore: new InMemoryPreferencesStore({ [WEB_ID]: defaultPreferences() }),
    messageStore,
    emailSender: new InMemoryEmailSender(),
    userDirectory: new InMemoryUserDirectory({
      [WEB_ID]: {
        webId: WEB_ID,
        email: 'alice@example.com',
        podUrl: POD_URL,
      },
    }),
  })

  const event: LifecycleEvent = {
    eventId: 'evt-1',
    eventType: 'account.created',
    occurredAt: '2026-07-07T10:00:00.000Z',
    envProfile: 'staging-testnet',
    issuer: 'https://staging.nodezero.social',
    webId: WEB_ID,
    podUrl: POD_URL,
  }

  const message = await orchestrator.ingestLifecycleEvent(event)
  assert.ok(message)
  assert.equal(messageStore.messages.length, 1)
  assert.equal(messageStore.messages[0]?.category, 'account')
})

void test('ingestLifecycleEvent drops message when category disabled', async () => {
  const messageStore = new InMemoryMessageStore()
  const orchestrator = new NotificationOrchestrator({
    preferencesStore: new InMemoryPreferencesStore({
      [WEB_ID]: defaultPreferences({
        categories: {
          account: false,
        },
      }),
    }),
    messageStore,
    emailSender: new InMemoryEmailSender(),
    userDirectory: new InMemoryUserDirectory({}),
  })

  const event: LifecycleEvent = {
    eventId: 'evt-1',
    eventType: 'account.created',
    occurredAt: '2026-07-07T10:00:00.000Z',
    envProfile: 'staging-testnet',
    issuer: 'https://staging.nodezero.social',
    webId: WEB_ID,
    podUrl: POD_URL,
  }

  const message = await orchestrator.ingestLifecycleEvent(event)
  assert.equal(message, null)
  assert.equal(messageStore.messages.length, 0)
})

void test('runDigest sends digest for available messages', async () => {
  const messageStore = new InMemoryMessageStore()
  const emailSender = new InMemoryEmailSender()

  messageStore.messages.push({
    messageId: 'm-1',
    userWebId: WEB_ID,
    category: 'account',
    occurredAt: '2026-07-07T10:00:00.000Z',
    subject: 'NodeZero update: account.created',
    body: 'body',
    dedupeKey: 'd1',
    sourceEventId: 'evt-1',
  })

  const orchestrator = new NotificationOrchestrator({
    preferencesStore: new InMemoryPreferencesStore({ [WEB_ID]: defaultPreferences() }),
    messageStore,
    emailSender,
    userDirectory: new InMemoryUserDirectory({
      [WEB_ID]: {
        webId: WEB_ID,
        email: 'alice@example.com',
        podUrl: POD_URL,
      },
    }),
  })

  const digest = await orchestrator.runDigest(
    WEB_ID,
    new Date('2026-07-07T00:00:00.000Z'),
    new Date('2026-07-07T23:59:59.000Z')
  )

  assert.ok(digest)
  assert.equal(emailSender.digests.length, 1)
  assert.match(emailSender.digests[0]?.subject ?? '', /NodeZero digest/)
})
