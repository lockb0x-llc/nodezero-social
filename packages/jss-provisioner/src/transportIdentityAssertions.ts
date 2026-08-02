import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { SessionClaims } from './sessionTokens.js'

export type TransportIdentityAudience = 'waku' | 'relay'

interface TransportIdentityClaims {
  sub: string
  account: string
  spk: string
  aud: TransportIdentityAudience
  iss: string
  iat: number
  exp: number
  jti: string
}

export interface TransportIdentityAssertionOptions {
  signingKey?: string
  issuer?: string
  ttlMs?: number
}

const DEFAULT_TTL_MS = 10 * 60_000

export class TransportIdentityAssertionManager {
  private readonly key: Buffer
  private readonly issuer: string
  private readonly ttlMs: number
  private readonly keyIsEphemeral: boolean

  constructor(options: TransportIdentityAssertionOptions = {}) {
    const rawKey = (
      options.signingKey ??
      process.env.JSS_TRANSPORT_IDENTITY_SIGNING_KEY ??
      process.env.JSS_RELATIONSHIP_DELIVERY_SIGNING_KEY ??
      ''
    ).trim()
    this.key = rawKey ? Buffer.from(rawKey, 'utf8') : randomBytes(32)
    this.keyIsEphemeral = !rawKey
    this.issuer = options.issuer ?? process.env.JSS_ISSUER_URL ?? 'https://staging.nodezero.social'
    this.ttlMs = options.ttlMs ?? Number(
      process.env.JSS_TRANSPORT_IDENTITY_ASSERTION_TTL_MS ?? DEFAULT_TTL_MS
    )
  }

  get usesEphemeralKey(): boolean {
    return this.keyIsEphemeral
  }

  issue(
    claims: SessionClaims,
    audience: TransportIdentityAudience,
    now = new Date(),
    subject = claims.sub
  ): string {
    if (!claims.spk || !/^G[A-Z2-7]{55}$/.test(claims.spk)) {
      throw new Error('The authenticated session has no valid Stellar identity key.')
    }
    if (subject !== claims.sub && !this.isCurrentPresenceSubject(claims.sub, audience, subject, now)) {
      throw new Error('Transport identity subject is not allowed.')
    }
    const payload: TransportIdentityClaims = {
      sub: subject,
      account: claims.sub,
      spk: claims.spk,
      aud: audience,
      iss: this.issuer,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor((now.getTime() + this.ttlMs) / 1000),
      jti: randomBytes(16).toString('hex'),
    }
    return this.encrypt(payload)
  }

  verify(input: {
    assertion: string
    audience: TransportIdentityAudience
    webId: string
    stellarPublicKey: string
    now?: Date
  }): boolean {
    try {
      const claims = this.decrypt(input.assertion)
      const now = input.now ?? new Date()
      return claims.iss === this.issuer &&
        claims.aud === input.audience &&
        claims.sub === input.webId &&
        claims.spk === input.stellarPublicKey &&
        Number.isFinite(claims.iat) &&
        Number.isFinite(claims.exp) &&
        claims.iat * 1000 <= now.getTime() + 60_000 &&
        claims.exp * 1000 > now.getTime()
    } catch {
      return false
    }
  }

  readVerified(assertion: string, audience: TransportIdentityAudience, now = new Date()): {
    webId: string
    accountWebId: string
    stellarPublicKey: string
    audience: TransportIdentityAudience
  } | null {
    try {
      const claims = this.decrypt(assertion)
      return this.verify({
        assertion,
        audience,
        webId: claims.sub,
        stellarPublicKey: claims.spk,
        now,
      })
        ? {
            webId: claims.sub,
            accountWebId: claims.account,
            stellarPublicKey: claims.spk,
            audience: claims.aud,
          }
        : null
    } catch {
      return null
    }
  }

  private encrypt(claims: TransportIdentityClaims): string {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), nonce)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(claims), 'utf8'),
      cipher.final(),
    ])
    return encode(Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]))
  }

  private decrypt(assertion: string): TransportIdentityClaims {
    const payload = decode(assertion)
    if (payload.length < 29) throw new Error('Invalid assertion payload.')
    const nonce = payload.subarray(0, 12)
    const tag = payload.subarray(12, 28)
    const ciphertext = payload.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), nonce)
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')) as TransportIdentityClaims
  }

  private encryptionKey(): Buffer {
    return createHash('sha256').update(this.key).digest()
  }

  private isCurrentPresenceSubject(
    accountWebId: string,
    audience: TransportIdentityAudience,
    subject: string,
    now: Date
  ): boolean {
    if (audience !== 'waku') return false
    const epoch = now.toISOString().slice(0, 13)
    const commitment = createHash('sha256')
      .update(`${accountWebId}:${epoch}`)
      .digest('base64url')
    return subject === `urn:nodezero:presence:${commitment}`
  }
}

export function isTransportIdentityAudience(value: unknown): value is TransportIdentityAudience {
  return value === 'waku' || value === 'relay'
}

function encode(value: Buffer): string {
  return value.toString('base64url')
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}
