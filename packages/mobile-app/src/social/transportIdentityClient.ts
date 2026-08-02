import type { MessageEnvelope } from '@nodezero/waku-comms'

export type TransportIdentityAudience = 'waku' | 'relay'

interface TransportIdentityPayload {
  assertion?: unknown
  webId?: unknown
  stellarPublicKey?: unknown
  audience?: unknown
}

export async function issueTransportIdentityAssertion(input: {
  provisionerUrl: string
  audience: TransportIdentityAudience
  subject?: string
  authFetch: typeof globalThis.fetch
}): Promise<string> {
  const response = await input.authFetch(
    `${normalizeProvisionerUrl(input.provisionerUrl)}/v1/transport-identity/assertion`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        audience: input.audience,
        ...(input.subject ? { subject: input.subject } : {}),
      }),
    }
  )
  if (!response.ok) throw new Error('Unable to establish transport identity.')
  const payload = (await response.json()) as TransportIdentityPayload
  if (
    typeof payload.assertion !== 'string' ||
    payload.audience !== input.audience
  ) throw new Error('Invalid transport identity response.')
  return payload.assertion
}

export async function verifyWakuEnvelopeIdentity(input: {
  provisionerUrl: string
  envelope: MessageEnvelope
  accountWebId?: string
  fetch?: typeof globalThis.fetch
}): Promise<boolean> {
  try {
    const response = await (input.fetch ?? globalThis.fetch)(
      `${normalizeProvisionerUrl(input.provisionerUrl)}/v1/transport-identity/verify`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assertion: input.envelope.transportIdentityAssertion,
          audience: 'waku',
          ...(input.accountWebId ? { accountWebId: input.accountWebId } : {}),
        }),
      }
    )
    if (!response.ok) return false
    const payload = (await response.json()) as TransportIdentityPayload
    return payload.audience === 'waku' &&
      payload.webId === input.envelope.senderWebId &&
      payload.stellarPublicKey === input.envelope.senderStellarPublicKey
  } catch {
    return false
  }
}

function normalizeProvisionerUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('Provisioner URL is required for transport identity.')
  return normalized
}
