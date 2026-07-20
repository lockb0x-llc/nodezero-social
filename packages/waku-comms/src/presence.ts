/**
 * @module presence
 * Presence-beacon protocol for H3-cell local discovery.
 *
 * Peers publish signed, ephemeral {@link PresenceBeacon} envelopes on
 * `presence-{h3Index}` topics roughly every {@link PRESENCE_BEACON_INTERVAL_MS}.
 * Consumers feed inbound messages into a {@link PresenceTracker}, which keeps
 * a live peer map and sweeps expired entries.
 *
 * Privacy model:
 * - The raw WebID never appears on the wire. Beacons carry a rotating
 *   commitment (base64url(SHA-256(webId + ':' + epoch))) and presence
 *   envelopes use a `urn:nodezero:presence:{commitment}` sender id.
 * - The Stellar public key that signs the beacon is visible (required for
 *   authenticity). Linkability via the on-chain lockb0x registry is an
 *   accepted tradeoff; the mutual-reveal handshake (Phase 4) exchanges raw
 *   WebIDs only over the pairwise DM topic.
 */

import type { InboundMessage, PresenceBeacon } from './types.js'

/** How often a client republishes its presence beacon. */
export const PRESENCE_BEACON_INTERVAL_MS = 30_000

/**
 * Beacon validity window. Three missed beacons ⇒ the peer disappears from
 * the live map on the next sweep.
 */
export const PRESENCE_BEACON_TTL_MS = 90_000

/**
 * Upper bound accepted for a beacon's `expiresAt` horizon. Prevents a peer
 * from pinning itself into everyone's live map with a far-future expiry.
 */
export const PRESENCE_MAX_TTL_MS = 10 * 60_000

const PRESENCE_SENDER_PREFIX = 'urn:nodezero:presence:'
const PRESENCE_TOPIC_PATTERN = /^\/[a-z0-9][a-z0-9-]*\/1\/presence-([0-9a-f]{15})\/proto$/

/**
 * Hour-bucket epoch string used to rotate presence commitments
 * (e.g. '2026-07-20T14'). Bounded linkability: a commitment is stable within
 * one hour and unlinkable across hours without knowing the WebID.
 */
export function presenceEpoch(at: Date = new Date()): string {
  return at.toISOString().slice(0, 13)
}

/**
 * Envelope sender id for presence beacons. Keeps the raw WebID off the wire
 * while remaining a syntactically valid opaque identifier.
 */
export function presenceSenderId(webIdCommitment: string): string {
  if (!webIdCommitment) {
    throw new Error('webIdCommitment is required')
  }
  return `${PRESENCE_SENDER_PREFIX}${webIdCommitment}`
}

/** Serialize a beacon into an envelope body. */
export function createPresenceBeaconBody(beacon: PresenceBeacon): string {
  return JSON.stringify(beacon)
}

/** Parse and shape-validate a beacon body. Returns null on junk. */
export function parsePresenceBeacon(body: string): PresenceBeacon | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    const candidate = parsed as Record<string, unknown>
    if (
      typeof candidate.webIdCommitment !== 'string' ||
      candidate.webIdCommitment.length === 0 ||
      typeof candidate.h3Index !== 'string' ||
      !/^[0-9a-f]{15}$/.test(candidate.h3Index) ||
      !Array.isArray(candidate.capabilities) ||
      !candidate.capabilities.every((value) => typeof value === 'string') ||
      typeof candidate.expiresAt !== 'string' ||
      Number.isNaN(Date.parse(candidate.expiresAt))
    ) {
      return null
    }
    return {
      webIdCommitment: candidate.webIdCommitment,
      h3Index: candidate.h3Index,
      capabilities: candidate.capabilities.filter(
        (value): value is string => typeof value === 'string',
      ),
      expiresAt: candidate.expiresAt,
    }
  } catch {
    return null
  }
}

/** A live peer derived from a verified presence beacon. */
export interface PresencePeer {
  /** Rotating WebID commitment (see topics.presenceCommitment). */
  webIdCommitment: string
  /** H3 cell the peer reported presence in. */
  h3Index: string
  /** Capability hints from the beacon (e.g. 'chat'). */
  capabilities: string[]
  /** Stellar public key that signed the beacon. */
  stellarPublicKey: string
  /** ISO timestamp of the most recent beacon from this peer. */
  lastSeenAt: string
  /** ISO expiry after which the peer is swept from the live map. */
  expiresAt: string
}

/** Options for {@link PresenceTracker}. */
export interface PresenceTrackerOptions {
  /** Clock override for deterministic tests. */
  now?: () => Date
}

/**
 * Live peer map fed by inbound presence messages.
 *
 * Ingest rules (all must hold, otherwise the message is dropped):
 * - envelope kind is 'presence' and the signature verified,
 * - the body parses as a {@link PresenceBeacon},
 * - the beacon's h3Index matches the presence topic it arrived on
 *   (prevents cross-cell replay),
 * - the beacon is not yet expired and its expiry is not absurdly far out.
 *
 * Peers are keyed by webIdCommitment; a newer beacon replaces the entry.
 */
export class PresenceTracker {
  private readonly peersByCommitment = new Map<string, PresencePeer>()
  private readonly now: () => Date

  constructor(options?: PresenceTrackerOptions) {
    this.now = options?.now ?? ((): Date => new Date())
  }

  /**
   * Process one inbound message. Returns the upserted peer, or null when the
   * message was dropped.
   */
  ingest(message: InboundMessage): PresencePeer | null {
    if (message.envelope.kind !== 'presence' || !message.verified) {
      return null
    }
    const topicMatch = PRESENCE_TOPIC_PATTERN.exec(message.contentTopic)
    if (!topicMatch) {
      return null
    }
    const beacon = parsePresenceBeacon(message.envelope.body)
    if (!beacon || beacon.h3Index !== topicMatch[1]) {
      return null
    }
    const nowMs = this.now().getTime()
    const expiresMs = Date.parse(beacon.expiresAt)
    if (expiresMs <= nowMs || expiresMs > nowMs + PRESENCE_MAX_TTL_MS) {
      return null
    }
    const peer: PresencePeer = {
      webIdCommitment: beacon.webIdCommitment,
      h3Index: beacon.h3Index,
      capabilities: beacon.capabilities,
      stellarPublicKey: message.envelope.senderStellarPublicKey,
      lastSeenAt: message.envelope.timestamp,
      expiresAt: beacon.expiresAt,
    }
    this.peersByCommitment.set(beacon.webIdCommitment, peer)
    return peer
  }

  /** Remove peers whose beacons have expired. Returns the number removed. */
  sweep(): number {
    const nowMs = this.now().getTime()
    let removed = 0
    for (const [commitment, peer] of this.peersByCommitment) {
      if (Date.parse(peer.expiresAt) <= nowMs) {
        this.peersByCommitment.delete(commitment)
        removed += 1
      }
    }
    return removed
  }

  /** Current live peers (unexpired), most recently seen first. */
  peers(): PresencePeer[] {
    this.sweep()
    return [...this.peersByCommitment.values()].sort(
      (a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
    )
  }

  /** Drop all tracked peers (e.g. when the user changes cells). */
  clear(): void {
    this.peersByCommitment.clear()
  }
}
