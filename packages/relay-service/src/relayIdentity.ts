export interface RelayIdentity {
  webId: string
  stellarPublicKey: string
}

export function readRelayIdentityAssertion(protocolHeader: string | undefined): string | null {
  if (!protocolHeader) return null
  const protocols = protocolHeader.split(',').map((value) => value.trim())
  if (protocols[0] !== 'nz-relay-v1') return null
  const assertion = protocols[1]
  return assertion && assertion.length <= 8 * 1024 ? assertion : null
}

export async function verifyRelayIdentity(input: {
  assertion: string
  provisionerUrl: string
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}): Promise<RelayIdentity | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 5_000)
  try {
    const response = await (input.fetch ?? globalThis.fetch)(
      `${input.provisionerUrl.replace(/\/+$/, '')}/v1/transport-identity/verify`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ assertion: input.assertion, audience: 'relay' }),
      }
    )
    if (!response.ok) return null
    const payload = (await response.json()) as Record<string, unknown>
    return payload.audience === 'relay' &&
      typeof payload.webId === 'string' &&
      /^G[A-Z2-7]{55}$/.test(String(payload.stellarPublicKey))
      ? { webId: payload.webId, stellarPublicKey: String(payload.stellarPublicKey) }
      : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function probeRelayIdentityVerifier(input: {
  provisionerUrl: string
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}): Promise<{ upstreamReachable: boolean; transportEnabled: boolean }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 5_000)
  try {
    const response = await (input.fetch ?? globalThis.fetch)(
      `${input.provisionerUrl.replace(/\/+$/, '')}/health`,
      { signal: controller.signal }
    )
    if (!response.ok) return { upstreamReachable: false, transportEnabled: false }
    const payload = (await response.json()) as Record<string, unknown>
    const transport = payload.transportIdentity
    const milestoneQ = payload.milestoneQ
    const flags = milestoneQ && typeof milestoneQ === 'object'
      ? (milestoneQ as Record<string, unknown>).flags
      : null
    return {
      upstreamReachable: payload.ok === true &&
        Boolean(transport && typeof transport === 'object' &&
          (transport as Record<string, unknown>).ready === true),
      transportEnabled: Boolean(flags && typeof flags === 'object' &&
        (flags as Record<string, unknown>).transport === true),
    }
  } catch {
    return { upstreamReachable: false, transportEnabled: false }
  } finally {
    clearTimeout(timer)
  }
}
