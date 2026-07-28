/**
 * @module P2PChannel
 *
 * Manages a WebRTC data channel between two NodeZero peers.
 *
 * The channel lifecycle:
 * 1. The initiating peer calls `createOffer()` to produce an SDP offer.
 * 2. The offer is transmitted to the remote peer via the `SignalRelay`.
 * 3. The remote peer calls `receiveOffer(offer)` then `createAnswer()`.
 * 4. The answer is relayed back and the initiator calls `receiveAnswer(answer)`.
 * 5. ICE candidates are exchanged via `addIceCandidate()` until the channel opens.
 * 6. Once open, call `send(message)` to exchange {@link P2PMessage}s.
 */

import EventEmitter from 'eventemitter3'
import type { P2PMessage, P2PChannelOptions } from './types.js'

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
]

/** Events emitted by {@link P2PChannel}. */
interface P2PChannelEvents {
  /** Fired when a new message arrives from the remote peer. */
  message: (msg: P2PMessage) => void
  /** Fired when the data channel is open and ready to send. */
  open: () => void
  /** Fired when the data channel closes. */
  close: () => void
  /** Fired when an ICE candidate is generated locally (relay it to the remote). */
  iceCandidate: (candidate: RTCIceCandidateInit) => void
  /** Fired on unrecoverable errors. */
  error: (err: Error) => void
}

/**
 * Wraps a `RTCPeerConnection` with a JSON data channel for sending
 * {@link P2PMessage}s between two NodeZero peers identified by their WebIDs.
 *
 * This class is intentionally thin – it does not know about the signalling
 * mechanism.  Use {@link SignalRelay} to exchange the SDP offer/answer and
 * ICE candidates.
 */
export class P2PChannel extends EventEmitter<P2PChannelEvents> {
  private readonly localWebId: string
  readonly remoteWebId: string
  private readonly pc: RTCPeerConnection
  private dataChannel: RTCDataChannel | null = null

  constructor(options: P2PChannelOptions) {
    super()
    this.localWebId = options.localWebId
    this.remoteWebId = options.remoteWebId

    this.pc = new RTCPeerConnection({
      iceServers: options.iceServers ?? DEFAULT_ICE_SERVERS,
    })

    this.pc.onicecandidate = ({ candidate }): void => {
      if (candidate) this.emit('iceCandidate', candidate.toJSON())
    }

    this.pc.ondatachannel = ({ channel }): void => {
      this.attachDataChannel(channel)
    }
  }

  /**
   * Creates an SDP offer and sets the local description.
   * Returns the offer to be relayed to the remote peer.
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.dataChannel = this.pc.createDataChannel('nodezero-chat', {
      ordered: true,
    })
    this.attachDataChannel(this.dataChannel)

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    return offer
  }

  /**
   * Receives the remote offer SDP and sets the remote description.
   * Call this on the answering peer after receiving the offer via the relay.
   */
  async receiveOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer))
  }

  /**
   * Creates an SDP answer after the remote offer has been received.
   * Returns the answer to be relayed back to the initiating peer.
   */
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    return answer
  }

  /**
   * Receives the remote answer SDP (initiating peer only).
   */
  async receiveAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer))
  }

  /**
   * Adds a remote ICE candidate to the peer connection.
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate))
  }

  /**
   * Sends a message to the remote peer.
   * Throws if the data channel is not yet open.
   */
  send(body: string): P2PMessage {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel is not open. Wait for the "open" event before sending.')
    }

    const msg: P2PMessage = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      senderWebId: this.localWebId,
      body,
    }

    this.dataChannel.send(JSON.stringify(msg))
    return msg
  }

  /**
   * Closes the peer connection and data channel.
   */
  close(): void {
    this.dataChannel?.close()
    this.pc.close()
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private attachDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel

    channel.onopen = (): void => {
      this.emit('open')
    }
    channel.onclose = (): void => {
      this.emit('close')
    }
    channel.onerror = (event): void => {
      const candidate = (event as RTCErrorEvent).error as unknown
      this.emit('error', candidate instanceof Error ? candidate : new Error('RTCDataChannel error'))
    }
    channel.onmessage = ({ data }): void => {
      try {
        const msg = JSON.parse(data as string) as P2PMessage
        this.emit('message', msg)
      } catch {
        this.emit('error', new Error(`Failed to parse incoming P2P message: ${String(data)}`))
      }
    }
  }
}
