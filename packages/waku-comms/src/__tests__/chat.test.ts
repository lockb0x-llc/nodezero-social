import {
  createBroadcastBody,
  createEncryptedChatBody,
  createPlainChatBody,
  createRevealBody,
  createRevealPayload,
  parseBroadcastBody,
  parseChatBody,
  parseRevealBody,
  parseRevealPayload,
} from '../chat.js'
import { decryptDmBody, encryptDmBody, generateDmKeyPair } from '../dm-cipher.js'
import { revealTopic } from '../topics.js'

describe('broadcast bodies', () => {
  it('round-trips a broadcast body', () => {
    const body = createBroadcastBody({ text: 'block party at the plaza' })
    expect(parseBroadcastBody(body)).toEqual({ text: 'block party at the plaza' })
  })

  it('rejects empty text on create and junk on parse', () => {
    expect(() => createBroadcastBody({ text: '   ' })).toThrow()
    expect(parseBroadcastBody('not json')).toBeNull()
    expect(parseBroadcastBody('{"text":""}')).toBeNull()
    expect(parseBroadcastBody('{"other":1}')).toBeNull()
  })
})

describe('chat bodies', () => {
  it('round-trips a plain chat body', () => {
    const body = createPlainChatBody('hi there')
    expect(parseChatBody(body)).toEqual({ scheme: 'plain', text: 'hi there' })
  })

  it('round-trips an encrypted chat body end to end', async () => {
    const recipient = await generateDmKeyPair()
    const sealed = await encryptDmBody(recipient.publicJwk, 'covert hello')
    const body = createEncryptedChatBody(sealed)
    const parsed = parseChatBody(body)
    expect(parsed?.scheme).toBe('ecies-p256')
    if (parsed?.scheme !== 'ecies-p256') throw new Error('expected sealed body')
    await expect(decryptDmBody(recipient.privateKey, parsed.sealed)).resolves.toBe('covert hello')
  })

  it('rejects junk chat bodies', () => {
    expect(parseChatBody('not json')).toBeNull()
    expect(parseChatBody('{"scheme":"plain"}')).toBeNull()
    expect(parseChatBody('{"scheme":"ecies-p256","sealed":{"v":1}}')).toBeNull()
    expect(parseChatBody('{"scheme":"rot13","text":"x"}')).toBeNull()
  })
})

describe('reveal handshake', () => {
  const payload = {
    webId: 'https://solid.example/alice/profile/card#me',
    dmPublicKeyJwk: { kty: 'EC' as const, crv: 'P-256' as const, x: 'xxxx', y: 'yyyy' },
    senderCommitment: 'c'.repeat(43),
  }

  it('round-trips a sealed reveal payload end to end', async () => {
    const recipient = await generateDmKeyPair()
    const sealed = await encryptDmBody(recipient.publicJwk, createRevealPayload(payload))
    const body = createRevealBody(sealed)
    const parsedSealed = parseRevealBody(body)
    expect(parsedSealed).not.toBeNull()
    const plaintext = await decryptDmBody(recipient.privateKey, parsedSealed!)
    expect(parseRevealPayload(plaintext)).toEqual(payload)
  })

  it('rejects incomplete reveal payloads', () => {
    expect(() => createRevealPayload({ ...payload, webId: '' })).toThrow()
    expect(parseRevealPayload('not json')).toBeNull()
    expect(parseRevealPayload(JSON.stringify({ ...payload, dmPublicKeyJwk: { kty: 'oct' } }))).toBeNull()
    expect(parseRevealPayload(JSON.stringify({ ...payload, senderCommitment: '' }))).toBeNull()
    expect(parseRevealBody('{"sealed":"nope"}')).toBeNull()
  })

  it('derives reveal topics from commitments', () => {
    const commitment = 'A1b2C3d4E5f6G7h8-_A1b2C3d4E5f6G7h8A1b2C3d4E'
    expect(revealTopic('nodezero-staging', commitment)).toBe(
      `/nodezero-staging/1/reveal-${commitment.slice(0, 32)}/proto`,
    )
    expect(() => revealTopic('nodezero-staging', 'short')).toThrow(/Invalid presence commitment/)
    expect(() => revealTopic('nodezero-staging', 'bad!chars'.repeat(4))).toThrow()
  })
})
