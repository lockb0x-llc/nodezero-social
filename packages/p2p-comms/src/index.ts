/**
 * @module p2p-comms
 *
 * Ephemeral, privacy-first peer-to-peer messaging layer for NodeZero.
 *
 * Design principles:
 * - Messages are NOT stored on any blockchain or centralised server.
 * - Ephemeral messages exist only in the live WebRTC data channel.
 * - If the user wants persistence, messages are encrypted and backed up to
 *   their own Solid Pod (handled by `@nodezero/solid-pod-sync`).
 * - No phone numbers, email addresses, or centralised user IDs are required.
 *   Peers are identified by their Solid WebID URL.
 */

export { P2PChannel } from './P2PChannel.js'
export { SignalRelay } from './SignalRelay.js'
export type {
  P2PMessage,
  P2PChannelOptions,
  SignalMessage,
  SignalRelayOptions,
} from './types.js'
