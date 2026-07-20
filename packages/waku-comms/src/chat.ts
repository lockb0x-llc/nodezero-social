/**
 * @module chat
 * Body schemas for the chat, broadcast, and mutual-reveal planes.
 *
 * All bodies are JSON strings inside a signed {@link MessageEnvelope}:
 * - 'broadcast' envelopes on cell-{h3} topics carry {@link BroadcastBody}.
 * - 'chat' envelopes on dm-{pairHash} topics carry {@link ChatBody} — either
 *   plaintext (signed but readable by topic observers) or an ECIES-sealed
 *   {@link DmCiphertext} when the recipient's DM session key is known.
 * - 'reveal' envelopes on reveal-{commitment} topics carry an ECIES-sealed
 *   {@link RevealPayload}: the only place a raw WebID crosses the ephemeral
 *   plane, and always encrypted to the commitment holder's session key.
 */

import {
  isDmCiphertext,
  isDmPublicJwk,
  type DmCiphertext,
  type DmPublicJwk,
} from './dm-cipher.js'

/** Body of a 'broadcast' envelope published to a cell topic. */
export interface BroadcastBody {
  /** Post text (bounded by envelope MAX_BODY_BYTES). */
  text: string
}

/** Serialize a broadcast body. */
export function createBroadcastBody(body: BroadcastBody): string {
  if (!body.text.trim()) {
    throw new Error('Broadcast text must not be empty')
  }
  return JSON.stringify({ text: body.text })
}

/** Parse and shape-validate a broadcast body. Returns null on junk. */
export function parseBroadcastBody(body: string): BroadcastBody | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Record<string, unknown>
    if (typeof candidate.text !== 'string' || candidate.text.length === 0) return null
    return { text: candidate.text }
  } catch {
    return null
  }
}

/** Body of a 'chat' envelope on a DM topic. */
export type ChatBody =
  | { scheme: 'plain'; text: string }
  | { scheme: 'ecies-p256'; sealed: DmCiphertext }

/** Serialize a plaintext chat body (signed, but readable by observers). */
export function createPlainChatBody(text: string): string {
  if (!text.trim()) {
    throw new Error('Chat text must not be empty')
  }
  return JSON.stringify({ scheme: 'plain', text })
}

/** Serialize an ECIES-sealed chat body. */
export function createEncryptedChatBody(sealed: DmCiphertext): string {
  return JSON.stringify({ scheme: 'ecies-p256', sealed })
}

/** Parse and shape-validate a chat body. Returns null on junk. */
export function parseChatBody(body: string): ChatBody | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Record<string, unknown>
    if (candidate.scheme === 'plain' && typeof candidate.text === 'string') {
      return { scheme: 'plain', text: candidate.text }
    }
    if (candidate.scheme === 'ecies-p256' && isDmCiphertext(candidate.sealed)) {
      return { scheme: 'ecies-p256', sealed: candidate.sealed }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Mutual-reveal payload: sealed to the target commitment holder's DM session
 * key and sent as the plaintext of an ECIES ciphertext inside a 'reveal'
 * envelope. Both directions of the handshake use this same shape.
 */
export interface RevealPayload {
  /** Sender's raw WebID (revealed only to the chosen peer). */
  webId: string
  /** Sender's DM session public key so the peer can reply E2EE. */
  dmPublicKeyJwk: DmPublicJwk
  /** Sender's current presence commitment, linking the reveal to a live peer. */
  senderCommitment: string
}

/** Serialize a reveal payload (plaintext side, pre-encryption). */
export function createRevealPayload(payload: RevealPayload): string {
  if (!payload.webId || !payload.senderCommitment) {
    throw new Error('Reveal payload requires webId and senderCommitment')
  }
  return JSON.stringify(payload)
}

/** Parse and shape-validate a decrypted reveal payload. Returns null on junk. */
export function parseRevealPayload(plaintext: string): RevealPayload | null {
  try {
    const parsed: unknown = JSON.parse(plaintext)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Record<string, unknown>
    if (
      typeof candidate.webId !== 'string' ||
      candidate.webId.length === 0 ||
      typeof candidate.senderCommitment !== 'string' ||
      candidate.senderCommitment.length === 0 ||
      !isDmPublicJwk(candidate.dmPublicKeyJwk)
    ) {
      return null
    }
    return {
      webId: candidate.webId,
      dmPublicKeyJwk: candidate.dmPublicKeyJwk,
      senderCommitment: candidate.senderCommitment,
    }
  } catch {
    return null
  }
}

/**
 * Serialize the body of a 'reveal' envelope: the sealed payload wrapped in a
 * versioned JSON container so observers see only ciphertext.
 */
export function createRevealBody(sealed: DmCiphertext): string {
  return JSON.stringify({ sealed })
}

/** Parse a 'reveal' envelope body into its sealed ciphertext. */
export function parseRevealBody(body: string): DmCiphertext | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Record<string, unknown>
    return isDmCiphertext(candidate.sealed) ? candidate.sealed : null
  } catch {
    return null
  }
}
