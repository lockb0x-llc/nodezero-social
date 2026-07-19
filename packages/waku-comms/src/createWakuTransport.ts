/**
 * @module createWakuTransport
 * Factory adapting a real @waku/sdk light node to the WakuTransport.
 *
 * This is the ONLY file in the package that touches @waku/sdk directly; all
 * SDK API churn is absorbed here.
 */

import { createDecoder, createEncoder, createLightNode, Protocols } from '@waku/sdk'
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
  })
  return new WakuTransport(adaptNode(node))
}

function adaptNode(node: LightNode): WakuNodeLike {
  return {
    start: () => node.start(),
    stop: () => node.stop(),
    waitForPeers: () => node.waitForPeers([Protocols.LightPush, Protocols.Filter]),
    hasPeers: () => node.libp2p.getConnections().length > 0,

    async lightPush(contentTopic: string, payload: Uint8Array, ephemeral: boolean): Promise<void> {
      const encoder = createEncoder({ contentTopic, ephemeral })
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
      const decoders = contentTopics.map((topic) => createDecoder(topic))
      const { error, subscription } = await node.filter.subscribe(decoders, (message) => {
        callback({ contentTopic: message.contentTopic, payload: message.payload })
      })
      if (error || !subscription) {
        throw new Error(`Waku filter subscription failed${error ? `: ${String(error)}` : ''}`)
      }
      return async () => {
        await subscription.unsubscribe(contentTopics)
      }
    },

    async storeQuery(
      contentTopic: string,
      since: Date,
      callback: (message: WakuDecodedMessage) => void,
    ): Promise<void> {
      const decoder = createDecoder(contentTopic)
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
      node.libp2p.addEventListener('peer:connect', onConnect)
      node.libp2p.addEventListener('peer:disconnect', () => {
        if (node.libp2p.getConnections().length === 0) {
          onDisconnect()
        }
      })
    },
  }
}
