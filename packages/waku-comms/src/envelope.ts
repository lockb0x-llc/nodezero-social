/**
 * @module envelope
 * Signed message envelopes for the NodeZero ephemeral plane.
 *
 * Authenticity is anchored to the device Stellar Ed25519 key: transport nodes
 * (nwaku, or any future fallback network) are never trusted for message
 * integrity. The signature covers a canonical serialization of every envelope
 * field except the signature itself.
 *
 * Wire encoding is currently canonical JSON (UTF-8). encode/decode are the
 * single seam for a future protobuf migration — nothing else in the package
 * may assume JSON.
 */

import { Keypair } from '@stellar/stellar-sdk'
import type { EnvelopeKind, EnvelopeSigner, MessageEnvelope } from './types.js'

const ENVELOPE_KINDS: readonly EnvelopeKind[] = ['chat', 'presence', 'broadcast', 'reveal', 'pod-pointer']
const MAX_BODY_BYTES = 64 * 1024

/** Input for {@link createEnvelope}. */
export interface CreateEnvelopeInput {
  senderWebId: string
  kind: EnvelopeKind
  body: string
  /** Override for deterministic tests; defaults to crypto.randomUUID(). */
  id?: string
  /** Override for deterministic tests; defaults to now. */
  timestamp?: string
}

/**
 * Canonical bytes covered by the envelope signature: a JSON array (not an
 * object) so field order is unambiguous by construction.
 */
export function canonicalSigningBytes(envelope: Omit<MessageEnvelope, 'signatureBase64'>): Uint8Array {
  const canonical = JSON.stringify([
    envelope.id,
    envelope.senderWebId,
    envelope.senderStellarPublicKey,
    envelope.transportIdentityAssertion,
    envelope.timestamp,
    envelope.kind,
    envelope.body,
  ])
  return new TextEncoder().encode(canonical)
}

/** Build and sign an envelope with the device Stellar key. */
export async function createEnvelope(
  signer: EnvelopeSigner,
  input: CreateEnvelopeInput,
): Promise<MessageEnvelope> {
  if (!input.senderWebId) {
    throw new Error('senderWebId is required')
  }
  if (!ENVELOPE_KINDS.includes(input.kind)) {
    throw new Error(`Unknown envelope kind: ${String(input.kind)}`)
  }
  const bodyBytes = new TextEncoder().encode(input.body)
  if (bodyBytes.byteLength === 0 || bodyBytes.byteLength > MAX_BODY_BYTES) {
    throw new Error(`Envelope body must be 1..${MAX_BODY_BYTES} bytes`)
  }

  const unsigned: Omit<MessageEnvelope, 'signatureBase64'> = {
    id: input.id ?? globalThis.crypto.randomUUID(),
    senderWebId: input.senderWebId,
    senderStellarPublicKey: signer.stellarPublicKey,
    transportIdentityAssertion: signer.transportIdentityAssertion,
    timestamp: input.timestamp ?? new Date().toISOString(),
    kind: input.kind,
    body: input.body,
  }
  const signature = await signer.sign(canonicalSigningBytes(unsigned))
  return { ...unsigned, signatureBase64: bytesToBase64(signature) }
}

/** Verify an envelope signature against its embedded Stellar public key. */
export function verifyEnvelope(envelope: MessageEnvelope): boolean {
  try {
    const keypair = Keypair.fromPublicKey(envelope.senderStellarPublicKey)
    const { signatureBase64, ...unsigned } = envelope
    void signatureBase64
    return keypair.verify(
      Buffer.from(canonicalSigningBytes(unsigned)),
      Buffer.from(base64ToBytes(envelope.signatureBase64)),
    )
  } catch {
    return false
  }
}

/** Encode an envelope to wire bytes (canonical JSON, UTF-8). */
export function encodeEnvelope(envelope: MessageEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope))
}

/** Decode wire bytes to an envelope, validating shape. Returns null on junk. */
export function decodeEnvelope(payload: Uint8Array): MessageEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payload))
    if (!isEnvelopeShape(parsed)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function isEnvelopeShape(value: unknown): value is MessageEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.senderWebId === 'string' &&
    typeof candidate.senderStellarPublicKey === 'string' &&
    typeof candidate.transportIdentityAssertion === 'string' &&
    typeof candidate.timestamp === 'string' &&
    typeof candidate.kind === 'string' &&
    ENVELOPE_KINDS.includes(candidate.kind as EnvelopeKind) &&
    typeof candidate.body === 'string' &&
    typeof candidate.signatureBase64 === 'string'
  )
}

/**
 * Convenience signer backed by an in-memory Stellar keypair. Production code
 * must adapt @nodezero/embedded-wallet's WalletService instead so secrets
 * stay in the enclave; this helper exists for tests and QA harnesses only.
 */
export function keypairSigner(keypair: Keypair): EnvelopeSigner {
  return {
    stellarPublicKey: keypair.publicKey(),
    transportIdentityAssertion: 'test-waku-identity-assertion',
    sign: (payload: Uint8Array) => Promise.resolve(new Uint8Array(keypair.sign(Buffer.from(payload)))),
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'))
}
