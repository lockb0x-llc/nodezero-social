/**
 * @module WakuTransport
 * MessageTransport implementation over a Waku light node.
 *
 * The transport is written against the narrow structural {@link WakuNodeLike}
 * interface rather than @waku/sdk's concrete classes so that:
 *  1. unit tests can inject an in-memory fake node, and
 *  2. SDK API churn is contained to the createWakuTransport factory.
 */

import { EventEmitter } from 'eventemitter3'
import { decodeEnvelope, encodeEnvelope, verifyEnvelope } from './envelope.js'
import type {
  InboundMessageHandler,
  MessageEnvelope,
  MessageTransport,
  PublishOptions,
  TransportEvents,
} from './types.js'

/** Message shape delivered by Waku subscribe/store callbacks. */
export interface WakuDecodedMessage {
  contentTopic: string
  payload: Uint8Array
}

/** Structural subset of a @waku/sdk light node used by this transport. */
export interface WakuNodeLike {
  start(): Promise<void>
  stop(): Promise<void>
  /** Wait until at least one peer supports lightpush + filter. */
  waitForPeers(): Promise<void>
  /** True when at least one peer connection is live. */
  hasPeers(): boolean
  /** Publish payload bytes to a content topic. Resolves after a peer ack. */
  lightPush(contentTopic: string, payload: Uint8Array, ephemeral: boolean): Promise<void>
  /** Subscribe to topics; returns an unsubscribe function. */
  filterSubscribe(
    contentTopics: string[],
    callback: (message: WakuDecodedMessage) => void,
  ): Promise<() => Promise<void>>
  /** Query stored history for a topic since a given time. */
  storeQuery(
    contentTopic: string,
    since: Date,
    callback: (message: WakuDecodedMessage) => void,
  ): Promise<void>
  /** Register libp2p connection lifecycle callbacks. */
  onConnectionChange(onConnect: () => void, onDisconnect: () => void): void
}

interface ActiveSubscription {
  contentTopics: string[]
  handler: InboundMessageHandler
  unsubscribe: (() => Promise<void>) | null
  lastDeliveredTimestamp?: Date
}

const DEFAULT_RECONNECT_CATCHUP_MS = 5 * 60_000

/** Pub/sub transport over Waku with reconnect-aware resubscription. */
export class WakuTransport implements MessageTransport {
  private readonly node: WakuNodeLike
  // Keyed by event name: eventemitter3's per-event ArgumentMap generics do
  // not compose with generic on/off wrappers over a mixed-arity event map.
  private readonly emitter = new EventEmitter<keyof TransportEvents>()
  private readonly subscriptions = new Set<ActiveSubscription>()
  private started = false

  constructor(node: WakuNodeLike) {
    this.node = node
    this.node.onConnectionChange(
      () => {
        this.emitter.emit('connected')
        void this.resubscribeAll()
      },
      () => this.emitter.emit('disconnected'),
    )
  }

  async start(): Promise<void> {
    if (this.started) {
      return
    }
    await this.node.start()
    await this.node.waitForPeers()
    this.started = true
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return
    }
    for (const subscription of this.subscriptions) {
      if (subscription.unsubscribe) {
        await subscription.unsubscribe().catch(() => undefined)
        subscription.unsubscribe = null
      }
    }
    this.subscriptions.clear()
    await this.node.stop()
    this.started = false
  }

  isConnected(): boolean {
    return this.started && this.node.hasPeers()
  }

  async publish(
    contentTopic: string,
    envelope: MessageEnvelope,
    options?: PublishOptions,
  ): Promise<void> {
    this.assertStarted()
    const ephemeral = options?.ephemeral ?? envelope.kind === 'presence'
    await this.node.lightPush(contentTopic, encodeEnvelope(envelope), ephemeral)
  }

  async subscribe(
    contentTopics: string[],
    handler: InboundMessageHandler,
  ): Promise<() => Promise<void>> {
    this.assertStarted()
    const subscription: ActiveSubscription = {
      contentTopics,
      handler,
      unsubscribe: null,
      lastDeliveredTimestamp: new Date(),
    }
    subscription.unsubscribe = await this.node.filterSubscribe(contentTopics, (message) =>
      this.deliver(subscription, message),
    )
    this.subscriptions.add(subscription)
    return async () => {
      this.subscriptions.delete(subscription)
      if (subscription.unsubscribe) {
        await subscription.unsubscribe()
        subscription.unsubscribe = null
      }
    }
  }

  async querySince(
    contentTopic: string,
    since: Date,
    handler: InboundMessageHandler,
  ): Promise<void> {
    this.assertStarted()
    await this.node.storeQuery(contentTopic, since, (message) => this.deliver(handler, message))
  }

  on<E extends keyof TransportEvents>(event: E, listener: TransportEvents[E]): void {
    this.emitter.on(event, listener)
  }

  off<E extends keyof TransportEvents>(event: E, listener: TransportEvents[E]): void {
    this.emitter.off(event, listener)
  }

  /** Decode, verify, and forward one raw transport message. */
  private deliver(
    target: InboundMessageHandler | ActiveSubscription,
    message: WakuDecodedMessage,
  ): void {
    const envelope = decodeEnvelope(message.payload)
    if (!envelope) {
      // Junk on a public topic is expected; drop silently.
      return
    }
    const handler = typeof target === 'function' ? target : target.handler
    if (typeof target !== 'function') {
      target.lastDeliveredTimestamp = new Date()
    }
    try {
      handler({
        contentTopic: message.contentTopic,
        envelope,
        verified: verifyEnvelope(envelope),
      })
    } catch (error) {
      this.emitter.emit('error', error instanceof Error ? error : new Error(String(error)))
    }
  }

  /** Re-establish filter subscriptions and catch up from message store after a reconnect. */
  private async resubscribeAll(): Promise<void> {
    for (const subscription of this.subscriptions) {
      try {
        if (subscription.unsubscribe) {
          await subscription.unsubscribe().catch(() => undefined)
        }
        subscription.unsubscribe = await this.node.filterSubscribe(
          subscription.contentTopics,
          (message) => this.deliver(subscription, message),
        )

        const since =
          subscription.lastDeliveredTimestamp ??
          new Date(Date.now() - DEFAULT_RECONNECT_CATCHUP_MS)
        for (const topic of subscription.contentTopics) {
          void this.node
            .storeQuery(topic, since, (message) => this.deliver(subscription, message))
            .catch(() => undefined)
        }
      } catch (error) {
        this.emitter.emit('error', error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  private assertStarted(): void {
    if (!this.started) {
      throw new Error('WakuTransport is not started')
    }
  }
}
