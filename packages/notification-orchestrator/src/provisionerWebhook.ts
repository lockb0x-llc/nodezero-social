import { NotificationOrchestrator } from './orchestrator.js'
import type { LifecycleEvent, NotificationMessage } from './types.js'

export interface ProvisionerWebhookIngestResult {
  accepted: boolean
  message: string
  messageId?: string
}

export interface ProvisioningLifecycleEvent extends LifecycleEvent {
  specVersion?: string
  stellarPublicKey?: string
  lockboxContractId?: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isProvisioningLifecycleEvent(payload: unknown): payload is ProvisioningLifecycleEvent {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Partial<ProvisioningLifecycleEvent>
  return (
    isNonEmptyString(candidate.eventId) &&
    isNonEmptyString(candidate.eventType) &&
    isNonEmptyString(candidate.occurredAt) &&
    isNonEmptyString(candidate.envProfile) &&
    isNonEmptyString(candidate.issuer)
  )
}

export async function ingestProvisionerEvent(
  orchestrator: NotificationOrchestrator,
  payload: unknown
): Promise<ProvisionerWebhookIngestResult> {
  if (!isProvisioningLifecycleEvent(payload)) {
    return {
      accepted: false,
      message: 'Invalid provisioning event payload.',
    }
  }

  const event: LifecycleEvent = {
    eventId: payload.eventId,
    eventType: payload.eventType,
    occurredAt: payload.occurredAt,
    envProfile: payload.envProfile,
    issuer: payload.issuer,
    ...(payload.webId ? { webId: payload.webId } : {}),
    ...(payload.podUrl ? { podUrl: payload.podUrl } : {}),
    metadata: {
      ...(payload.metadata ?? {}),
      ...(payload.stellarPublicKey ? { stellarPublicKey: payload.stellarPublicKey } : {}),
      ...(payload.lockboxContractId ? { lockboxContractId: payload.lockboxContractId } : {}),
    },
  }

  let message: NotificationMessage | null
  try {
    message = await orchestrator.ingestLifecycleEvent(event)
  } catch (error) {
    return {
      accepted: false,
      message:
        error instanceof Error
          ? `Failed to ingest provisioning event: ${error.message}`
          : 'Failed to ingest provisioning event.',
    }
  }

  if (!message) {
    return {
      accepted: true,
      message: 'Event accepted but no user message was enqueued.',
    }
  }

  return {
    accepted: true,
    message: 'Provisioning event ingested and enqueued.',
    messageId: message.messageId,
  }
}
