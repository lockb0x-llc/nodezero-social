/**
 * @module types
 * Shared type definitions for the p2p-comms package.
 */

/** An individual message exchanged over a P2P data channel. */
export interface P2PMessage {
  /** ISO 8601 timestamp when the message was created on the sender's device. */
  timestamp: string
  /** Sender's Solid WebID URL. */
  senderWebId: string
  /** UTF-8 message body. */
  body: string
  /** Unique message identifier (UUID v4). */
  id: string
}

/** WebRTC ICE / SDP signalling message used to establish a data channel. */
export type SignalPayload = RTCSessionDescriptionInit | RTCIceCandidateInit

export interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate'
  /** The local peer's Solid WebID. */
  from: string
  /** The remote peer's Solid WebID. */
  to: string
  /** SDP offer/answer object or ICE candidate JSON object. */
  payload: SignalPayload
}

/** Options for constructing a {@link P2PChannel}. */
export interface P2PChannelOptions {
  /** Your Solid WebID URL, used as the sender identity in messages. */
  localWebId: string
  /** The remote peer's Solid WebID URL. */
  remoteWebId: string
  /**
   * STUN/TURN server configuration.
   * Defaults to Google's public STUN server for development.
   */
  iceServers?: RTCIceServer[]
}

/** Options for constructing a {@link SignalRelay}. */
export interface SignalRelayOptions {
  /** WebSocket URL of the signalling relay server. */
  relayUrl: string
  /** Local peer's Solid WebID (used as the connection identity). */
  localWebId: string
}
