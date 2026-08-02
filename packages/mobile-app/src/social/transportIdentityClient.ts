import type { MessageEnvelope } from '@nodezero/waku-comms'

export type TransportIdentityAudience = 'waku' | 'relay'

interface TransportIdentityPayload {
  assertion?: unknown
  webId?: unknown
  stellarPublicKey?: unknown
  audience?: unknown
}

const WAKU_VERIFY_TIMEOUT_MS = 3_000
const WAKU_VERIFY_MAX_CONCURRENCY = 16
const pendingWakuVerifications = new Map<string, Promise<boolean>>()

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
  fetch?: typeof globalThis.fetch
}): Promise<boolean> {
  const key = [
    input.envelope.transportIdentityAssertion,
    input.envelope.senderWebId,
    input.envelope.senderStellarPublicKey,
  ].join('\n')
  const existing = pendingWakuVerifications.get(key)
  if (existing) return existing
  if (pendingWakuVerifications.size >= WAKU_VERIFY_MAX_CONCURRENCY) return false
  const verification = verifyWakuEnvelopeIdentityOnce(input)
  pendingWakuVerifications.set(key, verification)
  try {
    return await verification
  } finally {
    if (pendingWakuVerifications.get(key) === verification) {
      pendingWakuVerifications.delete(key)
    }
  }
}

async function verifyWakuEnvelopeIdentityOnce(input: {
  provisionerUrl: string
  envelope: MessageEnvelope
  fetch?: typeof globalThis.fetch
}): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WAKU_VERIFY_TIMEOUT_MS)
  try {
    const response = await (input.fetch ?? globalThis.fetch)(
      `${normalizeProvisionerUrl(input.provisionerUrl)}/v1/transport-identity/verify`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          assertion: input.envelope.transportIdentityAssertion,
          audience: 'waku',
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
  } finally {
    clearTimeout(timer)
  }
}

function normalizeProvisionerUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('Provisioner URL is required for transport identity.')
  return normalized
}
