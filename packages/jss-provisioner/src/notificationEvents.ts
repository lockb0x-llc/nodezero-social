import { randomUUID } from 'node:crypto'

export interface ProvisioningLifecycleEvent {
  specVersion: '1.0'
  eventId: string
  eventType: string
  occurredAt: string
  envProfile: string
  issuer: string
  webId?: string
  podUrl?: string
  stellarPublicKey?: string
  lockboxContractId?: string
  metadata?: Record<string, unknown>
}

export interface NotificationEventPublisher {
  readonly mode: 'none' | 'stdout' | 'webhook'
  publish(event: ProvisioningLifecycleEvent): Promise<void>
}

interface PublisherEnv {
  JSS_NOTIFICATION_EVENT_MODE?: string
  JSS_NOTIFICATION_WEBHOOK_URL?: string
  JSS_NOTIFICATION_WEBHOOK_TOKEN?: string
}

type FetchLike = typeof globalThis.fetch

function normalizeMode(raw: string | undefined): 'none' | 'stdout' | 'webhook' {
  const value = (raw ?? 'none').trim().toLowerCase()
  if (value === 'stdout' || value === 'webhook') return value
  return 'none'
}

function createNoopPublisher(): NotificationEventPublisher {
  return {
    mode: 'none',
    async publish(): Promise<void> {
      // Intentionally noop.
    },
  }
}

function createStdoutPublisher(): NotificationEventPublisher {
  return {
    mode: 'stdout',
    async publish(event): Promise<void> {
      console.log('[jss-provisioner:event]', JSON.stringify(event))
    },
  }
}

function createWebhookPublisher(
  webhookUrl: string,
  webhookToken: string,
  fetchImpl: FetchLike
): NotificationEventPublisher {
  return {
    mode: 'webhook',
    async publish(event): Promise<void> {
      const response = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          ...(webhookToken ? { authorization: `Bearer ${webhookToken}` } : {}),
          'x-nodezero-event-source': 'jss-provisioner',
        },
        body: JSON.stringify(event),
      })

      if (!response.ok) {
        throw new Error(`Notification webhook publish failed (${response.status}).`)
      }
    },
  }
}

export function createNotificationEventPublisherFromEnv(
  env: PublisherEnv = process.env,
  fetchImpl: FetchLike = globalThis.fetch
): NotificationEventPublisher {
  const mode = normalizeMode(env.JSS_NOTIFICATION_EVENT_MODE)

  if (mode === 'none') return createNoopPublisher()
  if (mode === 'stdout') return createStdoutPublisher()

  const webhookUrl = (env.JSS_NOTIFICATION_WEBHOOK_URL ?? '').trim()
  if (!webhookUrl) {
    console.warn(
      '[jss-provisioner:event] JSS_NOTIFICATION_EVENT_MODE=webhook but JSS_NOTIFICATION_WEBHOOK_URL is empty; events disabled.'
    )
    return createNoopPublisher()
  }

  return createWebhookPublisher(webhookUrl, (env.JSS_NOTIFICATION_WEBHOOK_TOKEN ?? '').trim(), fetchImpl)
}

export async function publishProvisioningEvent(
  publisher: NotificationEventPublisher,
  eventType: string,
  payload: Omit<ProvisioningLifecycleEvent, 'specVersion' | 'eventId' | 'eventType' | 'occurredAt'>
): Promise<void> {
  await publisher.publish({
    specVersion: '1.0',
    eventId: randomUUID(),
    eventType,
    occurredAt: new Date().toISOString(),
    ...payload,
  })
}
