import {
  decryptDmBody,
  encryptDmBody,
  generateDmKeyPair,
  isDmCiphertext,
  isDmPublicJwk,
} from '../dm-cipher.js'

describe('dm-cipher', () => {
  it('round-trips a plaintext between two session key pairs', async () => {
    const recipient = await generateDmKeyPair()
    const sealed = await encryptDmBody(recipient.publicJwk, 'hello, cell neighbor')
    expect(sealed.v).toBe(1)
    expect(sealed.alg).toBe('ECIES-P256-AESGCM')
    expect(isDmCiphertext(sealed)).toBe(true)
    const opened = await decryptDmBody(recipient.privateKey, sealed)
    expect(opened).toBe('hello, cell neighbor')
  })

  it('produces distinct ciphertexts for identical plaintexts (fresh ephemeral keys)', async () => {
    const recipient = await generateDmKeyPair()
    const a = await encryptDmBody(recipient.publicJwk, 'same text')
    const b = await encryptDmBody(recipient.publicJwk, 'same text')
    expect(a.ct).not.toBe(b.ct)
    expect(a.epk.x).not.toBe(b.epk.x)
  })

  it('rejects decryption with the wrong private key', async () => {
    const recipient = await generateDmKeyPair()
    const eavesdropper = await generateDmKeyPair()
    const sealed = await encryptDmBody(recipient.publicJwk, 'secret')
    await expect(decryptDmBody(eavesdropper.privateKey, sealed)).rejects.toThrow()
  })

  it('rejects tampered ciphertext', async () => {
    const recipient = await generateDmKeyPair()
    const sealed = await encryptDmBody(recipient.publicJwk, 'integrity matters')
    const tampered = { ...sealed, ct: sealed.ct.slice(0, -4) + 'AAAA' }
    await expect(decryptDmBody(recipient.privateKey, tampered)).rejects.toThrow()
  })

  it('rejects unsupported wire versions', async () => {
    const recipient = await generateDmKeyPair()
    const sealed = await encryptDmBody(recipient.publicJwk, 'x')
    await expect(decryptDmBody(recipient.privateKey, { ...sealed, v: 2 })).rejects.toThrow(
      /Unsupported DM ciphertext/,
    )
  })

  it('shape-checks public JWKs', async () => {
    const pair = await generateDmKeyPair()
    expect(isDmPublicJwk(pair.publicJwk)).toBe(true)
    expect(isDmPublicJwk({ kty: 'EC', crv: 'P-384', x: 'a', y: 'b' })).toBe(false)
    expect(isDmPublicJwk({ kty: 'EC', crv: 'P-256', x: '', y: 'b' })).toBe(false)
    expect(isDmPublicJwk(null)).toBe(false)
    expect(isDmPublicJwk('nope')).toBe(false)
  })
})
