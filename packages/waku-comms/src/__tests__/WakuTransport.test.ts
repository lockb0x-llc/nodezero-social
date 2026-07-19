import { Keypair } from '@stellar/stellar-sdk'
import { createEnvelope, encodeEnvelope, keypairSigner } from '../envelope.js'
import { WakuTransport } from '../WakuTransport.js'
import type { WakuDecodedMessage, WakuNodeLike } from '../WakuTransport.js'
import type { InboundMessage, MessageEnvelope } from '../types.js'

const WEB_ID = 'https://solid.nodezero.social/alice/profile/card#me'
const TOPIC = '/nodezero-local/1/cell-892830828cbffff/proto'

interface PublishedRecord {
  contentTopic: string
  payload: Uint8Array
  ephemeral: boolean
}

/** In-memory fake of the structural Waku node contract. */
class FakeWakuNode implements WakuNodeLike {
  published: PublishedRecord[] = []
  stored = new Map<string, Uint8Array[]>()
  subscribers = new Map<string, Set<(message: WakuDecodedMessage) => void>>()
  peers = 0
  subscribeCalls = 0
  private onConnect: (() => void) | null = null
  private onDisconnect: (() => void) | null = null

  start = (): Promise<void> => Promise.resolve()
  stop = (): Promise<void> => Promise.resolve()
  waitForPeers = (): Promise<void> => {
    this.peers = 1
    return Promise.resolve()
  }
  hasPeers = (): boolean => this.peers > 0

  lightPush = (contentTopic: string, payload: Uint8Array, ephemeral: boolean): Promise<void> => {
    this.published.push({ contentTopic, payload, ephemeral })
    if (!ephemeral) {
      const bucket = this.stored.get(contentTopic) ?? []
      bucket.push(payload)
      this.stored.set(contentTopic, bucket)
    }
    for (const callback of this.subscribers.get(contentTopic) ?? []) {
      callback({ contentTopic, payload })
    }
    return Promise.resolve()
  }

  filterSubscribe = (
    contentTopics: string[],
    callback: (message: WakuDecodedMessage) => void,
  ): Promise<() => Promise<void>> => {
    this.subscribeCalls += 1
    for (const topic of contentTopics) {
      const set = this.subscribers.get(topic) ?? new Set()
      set.add(callback)
      this.subscribers.set(topic, set)
    }
    return Promise.resolve(() => {
      for (const topic of contentTopics) {
        this.subscribers.get(topic)?.delete(callback)
      }
      return Promise.resolve()
    })
  }

  storeQuery = (
    contentTopic: string,
    _since: Date,
    callback: (message: WakuDecodedMessage) => void,
  ): Promise<void> => {
    for (const payload of this.stored.get(contentTopic) ?? []) {
      callback({ contentTopic, payload })
    }
    return Promise.resolve()
  }

  onConnectionChange = (onConnect: () => void, onDisconnect: () => void): void => {
    this.onConnect = onConnect
    this.onDisconnect = onDisconnect
  }

  simulateReconnect(): void {
    this.peers = 0
    this.onDisconnect?.()
    this.subscribers.clear()
    this.peers = 1
    this.onConnect?.()
  }
}

async function signedEnvelope(
  body: string,
  kind: MessageEnvelope['kind'] = 'chat',
): Promise<MessageEnvelope> {
  return createEnvelope(keypairSigner(Keypair.random()), { senderWebId: WEB_ID, kind, body })
}

describe('WakuTransport', () => {
  let node: FakeWakuNode
  let transport: WakuTransport

  beforeEach(async () => {
    node = new FakeWakuNode()
    transport = new WakuTransport(node)
    await transport.start()
  })

  it('rejects operations before start', async () => {
    const cold = new WakuTransport(new FakeWakuNode())
    await expect(cold.publish(TOPIC, await signedEnvelope('x'))).rejects.toThrow(/not started/)
  })

  it('publishes signed envelopes and delivers them to verified subscribers', async () => {
    const received: InboundMessage[] = []
    await transport.subscribe([TOPIC], (message) => received.push(message))

    const envelope = await signedEnvelope('hello cell')
    await transport.publish(TOPIC, envelope)

    expect(received).toHaveLength(1)
    expect(received[0].contentTopic).toBe(TOPIC)
    expect(received[0].envelope).toEqual(envelope)
    expect(received[0].verified).toBe(true)
  })

  it('marks tampered envelopes as unverified but still delivers them', async () => {
    const received: InboundMessage[] = []
    await transport.subscribe([TOPIC], (message) => received.push(message))

    const envelope = await signedEnvelope('original')
    const tampered = { ...envelope, body: 'forged' }
    await node.lightPush(TOPIC, encodeEnvelope(tampered), false)

    expect(received).toHaveLength(1)
    expect(received[0].verified).toBe(false)
  })

  it('drops undecodable junk without invoking the handler', async () => {
    const received: InboundMessage[] = []
    await transport.subscribe([TOPIC], (message) => received.push(message))
    await node.lightPush(TOPIC, new TextEncoder().encode('garbage'), false)
    expect(received).toHaveLength(0)
  })

  it('defaults presence envelopes to ephemeral and others to durable', async () => {
    await transport.publish(TOPIC, await signedEnvelope('{"h3Index":"x"}', 'presence'))
    await transport.publish(TOPIC, await signedEnvelope('post', 'broadcast'))
    expect(node.published[0].ephemeral).toBe(true)
    expect(node.published[1].ephemeral).toBe(false)
  })

  it('honours an explicit ephemeral override', async () => {
    await transport.publish(TOPIC, await signedEnvelope('chat'), { ephemeral: true })
    expect(node.published[0].ephemeral).toBe(true)
  })

  it('unsubscribe stops delivery', async () => {
    const received: InboundMessage[] = []
    const unsubscribe = await transport.subscribe([TOPIC], (message) => received.push(message))
    await unsubscribe()
    await transport.publish(TOPIC, await signedEnvelope('after unsubscribe'))
    expect(received).toHaveLength(0)
  })

  it('replays stored history via querySince', async () => {
    await transport.publish(TOPIC, await signedEnvelope('missed while offline'))
    const replayed: InboundMessage[] = []
    await transport.querySince(TOPIC, new Date(0), (message) => replayed.push(message))
    expect(replayed).toHaveLength(1)
    expect(replayed[0].envelope.body).toBe('missed while offline')
    expect(replayed[0].verified).toBe(true)
  })

  it('re-establishes subscriptions after a reconnect', async () => {
    const received: InboundMessage[] = []
    await transport.subscribe([TOPIC], (message) => received.push(message))
    expect(node.subscribeCalls).toBe(1)

    node.simulateReconnect()
    // resubscribeAll runs asynchronously off the connect event.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(node.subscribeCalls).toBe(2)

    await transport.publish(TOPIC, await signedEnvelope('after reconnect'))
    expect(received).toHaveLength(1)
  })

  it('emits lifecycle events', async () => {
    const events: string[] = []
    transport.on('connected', () => events.push('connected'))
    transport.on('disconnected', () => events.push('disconnected'))
    node.simulateReconnect()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['disconnected', 'connected'])
  })

  it('stop tears down subscriptions and is idempotent', async () => {
    await transport.subscribe([TOPIC], () => undefined)
    await transport.stop()
    await transport.stop()
    expect(transport.isConnected()).toBe(false)
    expect(node.subscribers.get(TOPIC)?.size ?? 0).toBe(0)
  })
})
