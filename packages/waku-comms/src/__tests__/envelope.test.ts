import { Keypair } from '@stellar/stellar-sdk'
import {
  createEnvelope,
  decodeEnvelope,
  encodeEnvelope,
  keypairSigner,
  verifyEnvelope,
} from '../envelope.js'

const WEB_ID = 'https://solid.nodezero.social/alice/profile/card#me'

describe('envelope create/verify', () => {
  const keypair = Keypair.random()
  const signer = keypairSigner(keypair)

  it('produces a verifiable Ed25519-signed envelope', async () => {
    const envelope = await createEnvelope(signer, {
      senderWebId: WEB_ID,
      kind: 'chat',
      body: 'hello from the ephemeral plane',
    })
    expect(envelope.senderStellarPublicKey).toBe(keypair.publicKey())
    expect(envelope.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(verifyEnvelope(envelope)).toBe(true)
  })

  it('fails verification when any signed field is tampered with', async () => {
    const envelope = await createEnvelope(signer, {
      senderWebId: WEB_ID,
      kind: 'broadcast',
      body: 'original body',
    })
    expect(verifyEnvelope({ ...envelope, body: 'forged body' })).toBe(false)
    expect(verifyEnvelope({ ...envelope, senderWebId: 'https://evil.example/#me' })).toBe(false)
    expect(verifyEnvelope({ ...envelope, timestamp: new Date(0).toISOString() })).toBe(false)
  })

  it('fails verification when the sender key is swapped', async () => {
    const envelope = await createEnvelope(signer, {
      senderWebId: WEB_ID,
      kind: 'chat',
      body: 'body',
    })
    const other = Keypair.random().publicKey()
    expect(verifyEnvelope({ ...envelope, senderStellarPublicKey: other })).toBe(false)
  })

  it('rejects invalid construction input', async () => {
    await expect(
      createEnvelope(signer, { senderWebId: '', kind: 'chat', body: 'x' }),
    ).rejects.toThrow(/senderWebId/)
    await expect(
      createEnvelope(signer, { senderWebId: WEB_ID, kind: 'chat', body: '' }),
    ).rejects.toThrow(/body/)
    await expect(
      createEnvelope(signer, {
        senderWebId: WEB_ID,
        kind: 'chat',
        body: 'a'.repeat(64 * 1024 + 1),
      }),
    ).rejects.toThrow(/body/)
  })
})

describe('envelope encode/decode', () => {
  const signer = keypairSigner(Keypair.random())

  it('round-trips over the wire encoding', async () => {
    const envelope = await createEnvelope(signer, {
      senderWebId: WEB_ID,
      kind: 'pod-pointer',
      body: JSON.stringify({
        resourceUrl: 'https://staging.nodezero.social/v1/pod-proxy/alice/posts/1',
        contentSha256: 'ab'.repeat(32),
        contentType: 'text/turtle',
      }),
    })
    const decoded = decodeEnvelope(encodeEnvelope(envelope))
    expect(decoded).toEqual(envelope)
    expect(decoded && verifyEnvelope(decoded)).toBe(true)
  })

  it('returns null for junk payloads instead of throwing', () => {
    expect(decodeEnvelope(new TextEncoder().encode('not json'))).toBeNull()
    expect(decodeEnvelope(new TextEncoder().encode('{"id":1}'))).toBeNull()
    expect(decodeEnvelope(new Uint8Array([0, 1, 2]))).toBeNull()
    expect(
      decodeEnvelope(new TextEncoder().encode(JSON.stringify({ kind: 'unknown-kind' }))),
    ).toBeNull()
  })
})
