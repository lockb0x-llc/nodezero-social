import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  parseRelationshipActivity,
  serializeRelationshipActivity,
  type RelationshipActivity,
} from '@nodezero/solid-pod-sync'

export const RELATIONSHIP_DELIVERY_ASSERTION_AUDIENCE = 'nz-relationship-delivery-v1'
export const RELATIONSHIP_DELIVERY_ASSERTION_PROPERTY =
  'https://nodezero.social/ns#deliveryAssertion'

interface RelationshipDeliveryAssertionClaims {
  sub: string
  recipient: string
  activityId: string
  payloadSha256: string
  aud: typeof RELATIONSHIP_DELIVERY_ASSERTION_AUDIENCE
  iss: string
  iat: number
  exp: number
  jti: string
}

export interface RelationshipDeliveryAssertionOptions {
  signingKey?: string
  issuer?: string
  ttlMs?: number
}

const DEFAULT_TTL_MS = 10 * 60_000

export class RelationshipDeliveryAssertionManager {
  private readonly key: Buffer
  private readonly issuer: string
  private readonly ttlMs: number
  private readonly keyIsEphemeral: boolean

  constructor(options: RelationshipDeliveryAssertionOptions = {}) {
    const rawKey = (
      options.signingKey ?? process.env.JSS_RELATIONSHIP_DELIVERY_SIGNING_KEY ?? ''
    ).trim()
    if (rawKey) {
      this.key = Buffer.from(rawKey, 'utf8')
      this.keyIsEphemeral = false
    } else {
      this.key = randomBytes(32)
      this.keyIsEphemeral = true
    }
    this.issuer = options.issuer ?? process.env.JSS_ISSUER_URL ?? 'https://staging.nodezero.social'
    this.ttlMs = options.ttlMs ?? Number(
      process.env.JSS_RELATIONSHIP_DELIVERY_ASSERTION_TTL_MS ?? DEFAULT_TTL_MS
    )
  }

  get usesEphemeralKey(): boolean {
    return this.keyIsEphemeral
  }

  issue(activity: RelationshipActivity, recipientWebId: string, now = new Date()): string {
    const claims: RelationshipDeliveryAssertionClaims = {
      sub: activity.actor,
      recipient: recipientWebId,
      activityId: activity.id,
      payloadSha256: activityDigest(activity),
      aud: RELATIONSHIP_DELIVERY_ASSERTION_AUDIENCE,
      iss: this.issuer,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor((now.getTime() + this.ttlMs) / 1000),
      jti: randomBytes(16).toString('hex'),
    }
    const header = encode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
    const payload = encode(Buffer.from(JSON.stringify(claims)))
    return `${header}.${payload}.${this.sign(`${header}.${payload}`)}`
  }

  verify(
    assertion: string,
    payload: unknown,
    recipientWebId: string,
    now = new Date()
  ): string | null {
    const parts = assertion.split('.')
    if (parts.length !== 3) return null
    const [header, encodedClaims, signature] = parts
    const expected = this.sign(`${header}.${encodedClaims}`)
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) return null

    let claims: RelationshipDeliveryAssertionClaims
    let activity: RelationshipActivity
    try {
      const parsedHeader = JSON.parse(decode(header).toString('utf8')) as {
        alg?: unknown
        typ?: unknown
      }
      if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return null
      claims = JSON.parse(decode(encodedClaims).toString('utf8')) as RelationshipDeliveryAssertionClaims
      activity = parseRelationshipActivity(payload)
    } catch {
      return null
    }
    if (claims.aud !== RELATIONSHIP_DELIVERY_ASSERTION_AUDIENCE) return null
    if (claims.iss !== this.issuer) return null
    if (claims.recipient !== recipientWebId) return null
    if (claims.sub !== activity.actor || claims.activityId !== activity.id) return null
    if (claims.payloadSha256 !== activityDigest(activity)) return null
    if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)) return null
    if (claims.iat * 1000 > now.getTime() + 60_000) return null
    if (claims.exp * 1000 <= now.getTime()) return null
    return claims.sub
  }

  private sign(value: string): string {
    return encode(createHmac('sha256', this.key).update(value).digest())
  }
}

export function readRelationshipDeliveryAssertion(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = (payload as Record<string, unknown>)[RELATIONSHIP_DELIVERY_ASSERTION_PROPERTY]
  return typeof value === 'string' && value.trim() ? value : null
}

function activityDigest(activity: RelationshipActivity): string {
  return createHash('sha256')
    .update(JSON.stringify(serializeRelationshipActivity(activity)))
    .digest('hex')
}

function encode(value: Buffer): string {
  return value.toString('base64url')
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}
