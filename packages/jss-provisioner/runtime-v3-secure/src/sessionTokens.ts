/**
 * @module sessionTokens
 *
 * Zero-dependency NodeZero session tokens.
 *
 * Session contract (fail-closed): a NodeZero session exists if and only if the
 * provisioner minted it after successfully exchanging the user's stored CSS
 * client credentials for a live DPoP-bound Solid token AND probing the Pod.
 * The access token is a compact HS256 JWT; the refresh token is an opaque
 * single-use value held server-side so logout / revocation is immediate.
 *
 * Signing key: `JSS_SESSION_SIGNING_KEY` (Key Vault-sourced in staging/prod).
 * Without it the manager generates an ephemeral key — sessions then survive
 * only for the process lifetime, which is acceptable for tests/local only.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_AUDIENCE = 'nz-session-v1'

const DEFAULT_ACCESS_TTL_MS = 60 * 60_000
const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60_000

export interface SessionClaims {
  /** WebID of the authenticated user. */
  sub: string
  /** Pod base URL. */
  pod: string
  /** Stellar public key the session was authenticated with (or null). */
  spk: string | null
  aud: string
  iss: string
  iat: number
  exp: number
  jti: string
}

export interface IssuedSession {
  accessToken: string
  refreshToken: string
  /** ISO expiry of the access token. */
  expiresAt: string
  webId: string
  podUrl: string
}

interface RefreshRecord {
  webId: string
  podUrl: string
  stellarPublicKey: string | null
  expiresAt: number
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64')
}

export interface SessionTokenOptions {
  signingKey?: string
  issuer?: string
  accessTtlMs?: number
  refreshTtlMs?: number
}

export class SessionTokenManager {
  private readonly key: Buffer
  private readonly issuer: string
  private readonly accessTtlMs: number
  private readonly refreshTtlMs: number
  private readonly keyIsEphemeral: boolean
  private refreshTokens = new Map<string, RefreshRecord>()

  constructor(options: SessionTokenOptions = {}) {
    const rawKey = (options.signingKey ?? process.env.JSS_SESSION_SIGNING_KEY ?? '').trim()
    if (rawKey) {
      this.key = Buffer.from(rawKey, 'utf8')
      this.keyIsEphemeral = false
    } else {
      this.key = randomBytes(32)
      this.keyIsEphemeral = true
    }
    this.issuer = options.issuer ?? process.env.JSS_ISSUER_URL ?? 'https://staging.nodezero.social'
    this.accessTtlMs = options.accessTtlMs ?? Number(process.env.JSS_SESSION_TTL_MS ?? DEFAULT_ACCESS_TTL_MS)
    this.refreshTtlMs = options.refreshTtlMs ?? Number(process.env.JSS_REFRESH_TTL_MS ?? DEFAULT_REFRESH_TTL_MS)
  }

  get usesEphemeralKey(): boolean {
    return this.keyIsEphemeral
  }

  private sign(input: string): string {
    return b64url(createHmac('sha256', this.key).update(input).digest())
  }

  issue(input: { webId: string; podUrl: string; stellarPublicKey?: string | null }): IssuedSession {
    const now = Date.now()
    const claims: SessionClaims = {
      sub: input.webId.trim(),
      pod: input.podUrl.trim(),
      spk: input.stellarPublicKey?.trim() || null,
      aud: SESSION_AUDIENCE,
      iss: this.issuer,
      iat: Math.floor(now / 1000),
      exp: Math.floor((now + this.accessTtlMs) / 1000),
      jti: randomBytes(16).toString('hex'),
    }
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
    const payload = b64url(Buffer.from(JSON.stringify(claims)))
    const signature = this.sign(`${header}.${payload}`)
    const accessToken = `${header}.${payload}.${signature}`

    const refreshToken = randomBytes(32).toString('base64url')
    this.refreshTokens.set(refreshToken, {
      webId: claims.sub,
      podUrl: claims.pod,
      stellarPublicKey: claims.spk,
      expiresAt: now + this.refreshTtlMs,
    })

    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      webId: claims.sub,
      podUrl: claims.pod,
    }
  }

  /** Verifies signature + expiry + audience; returns claims or null. */
  verify(accessToken: string): SessionClaims | null {
    const parts = accessToken.split('.')
    if (parts.length !== 3) return null
    const [header, payload, signature] = parts
    const expected = this.sign(`${header}.${payload}`)
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    let claims: SessionClaims
    try {
      claims = JSON.parse(b64urlDecode(payload).toString('utf8')) as SessionClaims
    } catch {
      return null
    }
    if (claims.aud !== SESSION_AUDIENCE) return null
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null
    if (typeof claims.sub !== 'string' || !claims.sub) return null
    return claims
  }

  /**
   * Rotates a refresh token: consumes the old one and returns the identity it
   * was bound to, or null when unknown/expired. The caller re-validates Solid
   * access before issuing a new session (fail-closed).
   */
  consumeRefreshToken(refreshToken: string): { webId: string; podUrl: string; stellarPublicKey: string | null } | null {
    const record = this.refreshTokens.get(refreshToken) ?? null
    if (!record) return null
    this.refreshTokens.delete(refreshToken)
    if (record.expiresAt < Date.now()) return null
    return {
      webId: record.webId,
      podUrl: record.podUrl,
      stellarPublicKey: record.stellarPublicKey,
    }
  }

  /** Invalidates every refresh token bound to the WebID (logout / revocation). */
  revokeByWebId(webId: string): number {
    const normalized = webId.trim()
    let revoked = 0
    for (const [token, record] of this.refreshTokens) {
      if (record.webId === normalized) {
        this.refreshTokens.delete(token)
        revoked += 1
      }
    }
    return revoked
  }
}
