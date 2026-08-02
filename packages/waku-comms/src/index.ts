/**
 * @nodezero/waku-comms
 *
 * Ephemeral pub/sub messaging for NodeZero over Waku:
 * - H3-cell-scoped content topics (presence, local broadcast) and pairwise DM
 *   topics, environment-prefixed for isolation.
 * - Stellar-Ed25519-signed message envelopes (transport is never trusted for
 *   authenticity).
 * - Transport-agnostic MessageTransport contract with a Waku light-node
 *   implementation.
 *
 * Durable state anchors to Solid Pods; this package only moves ephemeral
 * data and Pod pointers.
 */

export * from './types.js'
export {
  appPrefixForProfile,
  presenceTopic,
  cellTopic,
  dmTopic,
  revealTopic,
  presenceCommitment,
} from './topics.js'
export {
  createEnvelope,
  verifyEnvelope,
  encodeEnvelope,
  decodeEnvelope,
  canonicalSigningBytes,
  keypairSigner,
} from './envelope.js'
export type { CreateEnvelopeInput } from './envelope.js'
export {
  PRESENCE_BEACON_INTERVAL_MS,
  PRESENCE_BEACON_TTL_MS,
  PRESENCE_MAX_TTL_MS,
  presenceEpoch,
  presenceSenderId,
  isPresenceSenderForCommitment,
  createPresenceBeaconBody,
  parsePresenceBeacon,
  PresenceTracker,
} from './presence.js'
export type { PresencePeer, PresenceTrackerOptions } from './presence.js'
export {
  generateDmKeyPair,
  encryptDmBody,
  decryptDmBody,
  isDmPublicJwk,
  isDmCiphertext,
} from './dm-cipher.js'
export type { DmKeyPair, DmPublicJwk, DmCiphertext } from './dm-cipher.js'
export {
  createBroadcastBody,
  parseBroadcastBody,
  createPlainChatBody,
  createEncryptedChatBody,
  parseChatBody,
  createRevealPayload,
  parseRevealPayload,
  createRevealBody,
  parseRevealBody,
} from './chat.js'
export type { BroadcastBody, ChatBody, RevealPayload } from './chat.js'
export { WakuTransport } from './WakuTransport.js'
export type { WakuNodeLike, WakuDecodedMessage } from './WakuTransport.js'
export { createWakuTransport } from './createWakuTransport.js'
