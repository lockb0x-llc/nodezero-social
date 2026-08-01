import type { RelationshipSenderVerifier } from '@nodezero/solid-pod-sync'

export interface ProvisionerRelationshipSenderVerifierOptions {
  provisionerUrl: string
  authFetch: typeof globalThis.fetch
}

export class RelationshipSenderVerificationUnavailableError extends Error {
  readonly retryable = true

  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'RelationshipSenderVerificationUnavailableError'
  }
}

export function createProvisionerRelationshipSenderVerifier(
  options: ProvisionerRelationshipSenderVerifierOptions
): RelationshipSenderVerifier {
  const provisionerUrl = options.provisionerUrl.trim().replace(/\/+$/, '')
  return {
    async verifySender({ payload }): Promise<string | null> {
      if (!provisionerUrl) {
        throw new RelationshipSenderVerificationUnavailableError(
          'Relationship sender verification is not configured.',
          'sender_verification_unconfigured'
        )
      }
      try {
        const response = await options.authFetch(
          `${provisionerUrl}/v1/social/relationship-delivery/verify`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ activity: payload }),
          }
        )
        if (response.status === 422) return null
        if (!response.ok) {
          throw new RelationshipSenderVerificationUnavailableError(
            `Relationship sender verification returned HTTP ${response.status}.`,
            'sender_verification_unavailable'
          )
        }
        const result = await response.json() as { actorWebId?: unknown }
        if (typeof result.actorWebId !== 'string' || !result.actorWebId.trim()) {
          throw new RelationshipSenderVerificationUnavailableError(
            'Relationship sender verification returned an invalid response.',
            'sender_verification_invalid_response'
          )
        }
        return result.actorWebId
      } catch (error) {
        if (error instanceof RelationshipSenderVerificationUnavailableError) throw error
        throw new RelationshipSenderVerificationUnavailableError(
          'Relationship sender verification could not be reached.',
          'sender_verification_unavailable'
        )
      }
    },
  }
}
