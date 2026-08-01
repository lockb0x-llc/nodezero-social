import type { RelationshipSenderVerifier } from '@nodezero/solid-pod-sync'

export interface ProvisionerRelationshipSenderVerifierOptions {
  provisionerUrl: string
  authFetch: typeof globalThis.fetch
}

export function createProvisionerRelationshipSenderVerifier(
  options: ProvisionerRelationshipSenderVerifierOptions
): RelationshipSenderVerifier {
  const provisionerUrl = options.provisionerUrl.trim().replace(/\/+$/, '')
  return {
    async verifySender({ payload }): Promise<string | null> {
      if (!provisionerUrl) return null
      try {
        const response = await options.authFetch(
          `${provisionerUrl}/v1/social/relationship-delivery/verify`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ activity: payload }),
          }
        )
        if (!response.ok) return null
        const result = await response.json() as { actorWebId?: unknown }
        return typeof result.actorWebId === 'string' && result.actorWebId.trim()
          ? result.actorWebId
          : null
      } catch {
        return null
      }
    },
  }
}
