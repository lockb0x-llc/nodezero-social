/**
 * @module types
 * Shared type definitions for the waku-comms package.
 *
 * Design contract (see docs/architecture.md → messaging):
 * - Waku (or any pub/sub) is the *ephemeral* plane. Durable state anchors to
 *   the user's Solid Pod; large payloads travel as Pod pointers, never inline.
 * - Every envelope is signed with the device Stellar Ed25519 key so that
 *   transport nodes never need to be trusted for authenticity.
 * - The transport is abstracted behind {@link MessageTransport} so the
 *   underlying network (Waku today, GossipSub/Nostr fallback) is swappable.
 */

/** Message kinds carried over the ephemeral plane. */
export type EnvelopeKind =
  /** 1:1 or small-group chat message body (E2EE ciphertext once Phase 4 lands). */
  | 'chat'
  /** Presence beacon for an H3 cell (always ephemeral, never stored). */
  | 'presence'
  /** Local broadcast post to an H3 cell topic. */
  | 'broadcast'
  /** Pointer to durable content in a Solid Pod (attachments, long posts). */
  | 'pod-pointer'

/**
 * Signed message envelope exchanged over the pub/sub transport.
 *
 * The signature covers the canonical serialization of every field except
 * `signatureBase64` (see envelope.ts). Encoding is JSON for now; the encode/
 * decode seam in envelope.ts isolates a future protobuf migration.
 */
export interface MessageEnvelope {
  /** Unique message identifier (UUID v4). */
  id: string
  /** Sender's Solid WebID URL. */
  senderWebId: string
  /** Sender's Stellar account public key (G...), the signing identity. */
  senderStellarPublicKey: string
  /** ISO 8601 timestamp when the message was created on the sender's device. */
  timestamp: string
  /** Payload discriminator. */
  kind: EnvelopeKind
  /** UTF-8 payload: chat text, presence beacon JSON, or Pod pointer JSON. */
  body: string
  /** Base64 Ed25519 signature over the canonical envelope bytes. */
  signatureBase64: string
}

/**
 * Abstract signer so this package never touches raw secrets.
 * `@nodezero/embedded-wallet`'s WalletService satisfies this shape via a thin
 * adapter (sign bytes with the enclave-held device key).
 */
export interface EnvelopeSigner {
  /** Stellar account public key (G...) that will verify the signatures. */
  stellarPublicKey: string
  /** Sign the canonical envelope bytes; resolves to the raw Ed25519 signature. */
  sign(payload: Uint8Array): Promise<Uint8Array>
}

/** Presence beacon payload published on `presence-{h3Index}` topics. */
export interface PresenceBeacon {
  /**
   * Rotating commitment: base64url(SHA-256(webId + ':' + epoch)).
   * The raw WebID is only revealed during a mutual DM handshake.
   */
  webIdCommitment: string
  /** H3 cell index the peer is present in. */
  h3Index: string
  /** Capability hints (e.g. 'chat', 'docustream-share'). */
  capabilities: string[]
  /** ISO 8601 expiry; consumers must sweep beacons past this instant. */
  expiresAt: string
}

/** Pointer to durable content anchored in a Solid Pod. */
export interface PodPointer {
  /** Pod resource URL (fetched through the Pod Access Proxy). */
  resourceUrl: string
  /** Hex SHA-256 of the resource content for integrity verification. */
  contentSha256: string
  /** MIME type of the target resource. */
  contentType: string
}

/** A message received from the transport, with its topic context. */
export interface InboundMessage {
  /** Content topic the message arrived on. */
  contentTopic: string
  /** Decoded, signature-verified envelope. */
  envelope: MessageEnvelope
  /** True when the envelope signature verified against senderStellarPublicKey. */
  verified: boolean
}

/** Handler invoked for each inbound message on a subscription. */
export type InboundMessageHandler = (message: InboundMessage) => void

/** Publish options. */
export interface PublishOptions {
  /**
   * Ephemeral messages are propagated but never persisted by Store nodes
   * (presence beacons, typing indicators). Defaults to true for 'presence'
   * envelopes and false otherwise.
   */
  ephemeral?: boolean
}

/** Connection lifecycle events emitted by a transport. */
export interface TransportEvents {
  connected: () => void
  disconnected: () => void
  error: (error: Error) => void
}

/**
 * Transport-agnostic pub/sub contract.
 *
 * Implementations: {@link WakuTransport} (production), in-memory fake (tests).
 * A Nostr or raw-GossipSub fallback must be able to satisfy this interface
 * without changes to app code.
 */
export interface MessageTransport {
  /** Connect to the network and wait until at least one peer is usable. */
  start(): Promise<void>
  /** Tear down subscriptions and disconnect. Safe to call repeatedly. */
  stop(): Promise<void>
  /** True when the transport currently has a usable peer connection. */
  isConnected(): boolean
  /** Publish a signed envelope to a content topic. Resolves after peer ack. */
  publish(contentTopic: string, envelope: MessageEnvelope, options?: PublishOptions): Promise<void>
  /**
   * Subscribe to one or more content topics. Returns an unsubscribe function.
   * Re-subscription after reconnect is the implementation's responsibility.
   */
  subscribe(contentTopics: string[], handler: InboundMessageHandler): Promise<() => Promise<void>>
  /**
   * Query historical (non-ephemeral) messages on a topic since a given time.
   * Used for offline DM catch-up. Best-effort: durability is the Pod's job.
   */
  querySince(contentTopic: string, since: Date, handler: InboundMessageHandler): Promise<void>
  /** Register a lifecycle event listener. */
  on<E extends keyof TransportEvents>(event: E, listener: TransportEvents[E]): void
  /** Remove a lifecycle event listener. */
  off<E extends keyof TransportEvents>(event: E, listener: TransportEvents[E]): void
}

/** Options for constructing a {@link WakuTransport}. */
export interface WakuTransportOptions {
  /**
   * Multiaddrs of NodeZero-operated nwaku bootstrap peers
   * (e.g. /dns4/waku-staging.nodezero.social/tcp/443/wss/p2p/16Uiu2...).
   * Sourced from NZ_WAKU_BOOTSTRAP_PEERS; never hard-code per-env values.
   */
  bootstrapPeers: string[]
  /**
   * Environment prefix for content topics ('nodezero-local',
   * 'nodezero-staging', 'nodezero'). Must match the active NZ_ENV_PROFILE —
   * cross-environment topic traffic violates the isolation matrix.
   */
  appPrefix: string
}
