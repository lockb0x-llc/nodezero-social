/**
 * @module createWakuTransport
 * Factory adapting a real @waku/sdk light node to the WakuTransport.
 *
 * This is the ONLY file in the package that touches @waku/sdk directly; all
 * SDK API churn is absorbed here.
 */

import { createLightNode, Protocols, WakuEvent } from '@waku/sdk'
import type { LightNode } from '@waku/sdk'
import { WakuTransport } from './WakuTransport.js'
import type { WakuDecodedMessage, WakuNodeLike } from './WakuTransport.js'
import type { WakuTransportOptions } from './types.js'

/** Create a WakuTransport backed by a @waku/sdk light node. */
export async function createWakuTransport(options: WakuTransportOptions): Promise<WakuTransport> {
  if (options.bootstrapPeers.length === 0) {
    throw new Error(
      'At least one Waku bootstrap peer is required (NZ_WAKU_BOOTSTRAP_PEERS unresolved?)',
    )
  }
  const node = await createLightNode({
    bootstrapPeers: options.bootstrapPeers,
    defaultBootstrap: false,
    // Private NodeZero cluster (static sharding); js-waku defaults to The
    // Waku Network (clusterId 1) if unspecified.
    networkConfig: { clusterId: options.clusterId ?? 0 },
    // Bootstrap peers are the only trusted entry points — no public discovery.
    discovery: { peerExchange: false, dns: false, peerCache: false },
    // Local dev nwaku is plain ws://; the default filter admits only wss/dns.
    ...(options.allowInsecureWs ? { libp2p: { filterMultiaddrs: false } } : {}),
  })
  return new WakuTransport(adaptNode(node))
}

function adaptNode(node: LightNode): WakuNodeLike {
  return {
    start: () => node.start(),
    stop: () => node.stop(),
    waitForPeers: () => node.waitForPeers([Protocols.LightPush, Protocols.Filter]),
    hasPeers: () => node.isConnected(),

    async lightPush(contentTopic: string, payload: Uint8Array, ephemeral: boolean): Promise<void> {
      const encoder = node.createEncoder({ contentTopic, ephemeral })
      const result = await node.lightPush.send(encoder, { payload })
      if (result.successes.length === 0) {
        const detail = result.failures.map((failure) => failure.error).join('; ')
        throw new Error(`Waku light push was not acknowledged by any peer${detail ? `: ${detail}` : ''}`)
      }
    },

    async filterSubscribe(
      contentTopics: string[],
      callback: (message: WakuDecodedMessage) => void,
    ): Promise<() => Promise<void>> {
      const decoders = contentTopics.map((topic) => node.createDecoder({ contentTopic: topic }))
      const subscribed = await node.filter.subscribe(decoders, (message) => {
        callback({ contentTopic: message.contentTopic, payload: message.payload })
      })
      if (!subscribed) {
        throw new Error('Waku filter subscription failed')
      }
      return async () => {
        await node.filter.unsubscribe(decoders)
      }
    },

    async storeQuery(
      contentTopic: string,
      since: Date,
      callback: (message: WakuDecodedMessage) => void,
    ): Promise<void> {
      const decoder = node.createDecoder({ contentTopic })
      for await (const page of node.store.queryGenerator([decoder], {
        timeStart: since,
      })) {
        const messages = await Promise.all(page)
        for (const message of messages) {
          if (message) {
            callback({ contentTopic: message.contentTopic, payload: message.payload })
          }
        }
      }
    },

    onConnectionChange(onConnect: () => void, onDisconnect: () => void): void {
      node.events.addEventListener(WakuEvent.Connection, (event: CustomEvent<boolean>) => {
        if (event.detail) {
          onConnect()
        } else {
          onDisconnect()
        }
      })
    },
  }
}
