/**
 * @module SignalRelay
 *
 * WebSocket-based signalling relay for WebRTC peer discovery.
 *
 * The relay is a *thin* pass-through server – it routes SDP offer/answer and
 * ICE candidate messages between peers identified by their Solid WebID URLs.
 * It does NOT store messages and does NOT have access to message content.
 *
 * Protocol:
 * 1. Connect to `relayUrl` with the local WebID as the auth token.
 * 2. Send `{ type: 'offer' | 'answer' | 'ice-candidate', from, to, payload }`.
 * 3. The relay delivers the message to the peer whose WebID matches `to`.
 */

import EventEmitter from 'eventemitter3'
import type { SignalMessage, SignalRelayOptions } from './types.js'

/** Events emitted by {@link SignalRelay}. */
interface SignalRelayEvents {
  /** Fired when a signalling message arrives for the local peer. */
  signal: (msg: SignalMessage) => void
  /** Fired when the WebSocket connection is established. */
  connected: () => void
  /** Fired when the WebSocket connection closes. */
  disconnected: () => void
  /** Fired on WebSocket or protocol errors. */
  error: (err: Error) => void
}

/**
 * Manages the WebSocket connection to the NodeZero signalling relay server.
 * Use this alongside {@link P2PChannel} to negotiate WebRTC connections.
 *
 * @example
 * ```ts
 * const relay = new SignalRelay({
 *   relayUrl: 'wss://relay.nodezero.social',
 *   localWebId: 'https://alice.solidcommunity.net/profile/card#me',
 * })
 *
 * relay.on('connected', () => console.log('Relay connected'))
 * relay.on('signal', async (msg) => {
 *   if (msg.type === 'offer') { // handle offer … }
 * })
 *
 * relay.connect()
 * relay.send({ type: 'offer', from: localWebId, to: remoteWebId, payload: offerSdp })
 * ```
 */
export class SignalRelay extends EventEmitter<SignalRelayEvents> {
  private readonly relayUrl: string
  private readonly localWebId: string
  private ws: WebSocket | null = null

  constructor(options: SignalRelayOptions) {
    super()
    this.relayUrl = options.relayUrl
    this.localWebId = options.localWebId
  }

  /**
   * Opens the WebSocket connection to the relay server.
   * The local WebID is passed as a query parameter so the server can route
   * incoming signals to this peer.
   */
  connect(): void {
    const url = new URL(this.relayUrl)
    url.searchParams.set('webId', this.localWebId)

    this.ws = new WebSocket(url.toString())

    this.ws.onopen = () => this.emit('connected')
    this.ws.onclose = () => this.emit('disconnected')
    this.ws.onerror = () => this.emit('error', new Error('SignalRelay WebSocket error'))

    this.ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data as string) as SignalMessage
        this.emit('signal', msg)
      } catch {
        this.emit(
          'error',
          new Error(`SignalRelay: failed to parse message: ${String(data)}`)
        )
      }
    }
  }

  /**
   * Sends a signalling message to a remote peer via the relay.
   * @throws If the WebSocket is not open.
   */
  send(msg: SignalMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('SignalRelay is not connected. Call connect() first.')
    }
    this.ws.send(JSON.stringify(msg))
  }

  /**
   * Closes the WebSocket connection.
   */
  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }
}
