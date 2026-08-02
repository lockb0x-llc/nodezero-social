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
}): Promise<RelayIdentity | null> {
  try {
    const response = await (input.fetch ?? globalThis.fetch)(
      `${input.provisionerUrl.replace(/\/+$/, '')}/v1/transport-identity/verify`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
  }
}
