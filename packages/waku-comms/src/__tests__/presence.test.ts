import { Keypair } from '@stellar/stellar-sdk'
import { createEnvelope, keypairSigner } from '../envelope.js'
import {
  PRESENCE_BEACON_TTL_MS,
  PRESENCE_MAX_TTL_MS,
  PresenceTracker,
  createPresenceBeaconBody,
  parsePresenceBeacon,
  presenceEpoch,
  presenceSenderId,
} from '../presence.js'
import type { InboundMessage, MessageEnvelope, PresenceBeacon } from '../types.js'

const H3 = '892830828cbffff'
const OTHER_H3 = '892830828d3ffff'
const TOPIC = `/nodezero-local/1/presence-${H3}/proto`
const NOW = new Date('2026-07-20T14:10:00.000Z')

function beacon(overrides?: Partial<PresenceBeacon>): PresenceBeacon {
  return {
    webIdCommitment: 'commitment-abc',
    h3Index: H3,
    capabilities: ['chat'],
    expiresAt: new Date(NOW.getTime() + PRESENCE_BEACON_TTL_MS).toISOString(),
    ...overrides,
  }
}

async function presenceMessage(
  signer = keypairSigner(Keypair.random()),
  overrides?: {
    beacon?: Partial<PresenceBeacon>
    contentTopic?: string
    verified?: boolean
    envelope?: Partial<MessageEnvelope>
  },
): Promise<InboundMessage> {
  const envelope = await createEnvelope(signer, {
    senderWebId: presenceSenderId(overrides?.beacon?.webIdCommitment ?? 'commitment-abc'),
    kind: 'presence',
    body: createPresenceBeaconBody(beacon(overrides?.beacon)),
    timestamp: NOW.toISOString(),
  })
  return {
    contentTopic: overrides?.contentTopic ?? TOPIC,
    envelope: { ...envelope, ...overrides?.envelope },
    verified: overrides?.verified ?? true,
  }
}

describe('presenceEpoch', () => {
  it('buckets timestamps by hour', () => {
    expect(presenceEpoch(new Date('2026-07-20T14:10:59.999Z'))).toBe('2026-07-20T14')
    expect(presenceEpoch(new Date('2026-07-20T14:59:59.999Z'))).toBe('2026-07-20T14')
    expect(presenceEpoch(new Date('2026-07-20T15:00:00.000Z'))).toBe('2026-07-20T15')
  })
})

describe('presenceSenderId', () => {
  it('wraps the commitment in an opaque URN, never the WebID', () => {
    expect(presenceSenderId('abc123')).toBe('urn:nodezero:presence:abc123')
    expect(() => presenceSenderId('')).toThrow(/required/)
  })
})

describe('beacon body round-trip', () => {
  it('serializes and parses a valid beacon', () => {
    const original = beacon()
    expect(parsePresenceBeacon(createPresenceBeaconBody(original))).toEqual(original)
  })

  it('rejects junk and malformed beacons', () => {
    expect(parsePresenceBeacon('not json')).toBeNull()
    expect(parsePresenceBeacon('42')).toBeNull()
    expect(parsePresenceBeacon(JSON.stringify({ webIdCommitment: 'x' }))).toBeNull()
    expect(
      parsePresenceBeacon(createPresenceBeaconBody(beacon({ h3Index: 'not-an-h3' as never }))),
    ).toBeNull()
    expect(
      parsePresenceBeacon(createPresenceBeaconBody(beacon({ expiresAt: 'not-a-date' }))),
    ).toBeNull()
    expect(
      parsePresenceBeacon(JSON.stringify({ ...beacon(), capabilities: ['chat', 42] })),
    ).toBeNull()
  })

  it('carries an optional DM session public key and rejects malformed ones', () => {
    const jwk = { kty: 'EC' as const, crv: 'P-256' as const, x: 'xxxx', y: 'yyyy' }
    const withKey = beacon({ dmPublicKeyJwk: jwk })
    expect(parsePresenceBeacon(createPresenceBeaconBody(withKey))).toEqual(withKey)
    expect(
      parsePresenceBeacon(JSON.stringify({ ...beacon(), dmPublicKeyJwk: { kty: 'oct' } })),
    ).toBeNull()
  })
})

describe('PresenceTracker', () => {
  function tracker(now: Date = NOW): PresenceTracker {
    return new PresenceTracker({ now: () => now })
  }

  it('ingests a verified beacon and lists the peer', async () => {
    const t = tracker()
    const message = await presenceMessage()
    const peer = t.ingest(message)
    expect(peer).not.toBeNull()
    expect(t.peers()).toHaveLength(1)
    expect(t.peers()[0]).toMatchObject({
      webIdCommitment: 'commitment-abc',
      h3Index: H3,
      capabilities: ['chat'],
      stellarPublicKey: message.envelope.senderStellarPublicKey,
    })
  })

  it('drops unverified envelopes', async () => {
    const t = tracker()
    expect(t.ingest(await presenceMessage(undefined, { verified: false }))).toBeNull()
    expect(t.peers()).toHaveLength(0)
  })

  it('drops an envelope alias that does not match the beacon commitment', async () => {
    const t = tracker()
    const message = await presenceMessage()
    expect(t.ingest({
      ...message,
      envelope: {
        ...message.envelope,
        senderWebId: presenceSenderId('different-commitment'),
      },
    })).toBeNull()
    expect(t.peers()).toHaveLength(0)
  })

  it('drops non-presence envelope kinds', async () => {
    const t = tracker()
    const message = await presenceMessage()
    expect(
      t.ingest({ ...message, envelope: { ...message.envelope, kind: 'chat' } }),
    ).toBeNull()
  })

  it('drops beacons whose cell does not match the topic (cross-cell replay)', async () => {
    const t = tracker()
    expect(
      t.ingest(await presenceMessage(undefined, { beacon: { h3Index: OTHER_H3 } })),
    ).toBeNull()
    expect(
      t.ingest(
        await presenceMessage(undefined, { contentTopic: '/nodezero-local/1/cell-x/proto' }),
      ),
    ).toBeNull()
  })

  it('drops expired beacons and far-future expiry pinning', async () => {
    const t = tracker()
    expect(
      t.ingest(
        await presenceMessage(undefined, {
          beacon: { expiresAt: new Date(NOW.getTime() - 1).toISOString() },
        }),
      ),
    ).toBeNull()
    expect(
      t.ingest(
        await presenceMessage(undefined, {
          beacon: { expiresAt: new Date(NOW.getTime() + PRESENCE_MAX_TTL_MS + 1000).toISOString() },
        }),
      ),
    ).toBeNull()
  })

  it('replaces an existing peer on a newer beacon (keyed by commitment)', async () => {
    const t = tracker()
    t.ingest(await presenceMessage(undefined, { beacon: { capabilities: ['chat'] } }))
    t.ingest(
      await presenceMessage(undefined, { beacon: { capabilities: ['chat', 'docustream-share'] } }),
    )
    expect(t.peers()).toHaveLength(1)
    expect(t.peers()[0]?.capabilities).toEqual(['chat', 'docustream-share'])
  })

  it('sweeps peers past their expiry', async () => {
    let now = NOW
    const t = new PresenceTracker({ now: (): Date => now })
    t.ingest(await presenceMessage())
    expect(t.peers()).toHaveLength(1)

    now = new Date(NOW.getTime() + PRESENCE_BEACON_TTL_MS + 1000)
    expect(t.sweep()).toBe(1)
    expect(t.peers()).toHaveLength(0)
  })

  it('clear() empties the live map', async () => {
    const t = tracker()
    t.ingest(await presenceMessage())
    t.clear()
    expect(t.peers()).toHaveLength(0)
  })
})
