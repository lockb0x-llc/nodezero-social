/**
 * @module StellarLoginHandler
 *
 * CSS v7 Components.js interaction handler that enables passwordless
 * authentication for returning NodeZero users.
 *
 * The handler is registered at `/.account/login/stellar/` alongside the
 * existing `/.account/login/password/` endpoint.
 *
 * Flow:
 *  1. The NodeZero app derives a Stellar-signed challenge token via the
 *     provisioner (`POST /v1/auth/stellar-token`).
 *  2. The OIDC redirect URL carries `nz_stellar_token` and
 *     `nz_stellar_token_verify` params; the login template detects them and
 *     calls this endpoint instead of `password.login`.
 *  3. This handler validates the token by calling back to the provisioner
 *     (`POST /v1/auth/stellar-verify`) over an HMAC-authenticated channel.
 *  4. On success it finds the account ID from the webId returned by the
 *     provisioner and delegates session-cookie generation to the
 *     `ResolveLoginHandler` base class — exactly as `PasswordLoginHandler`
 *     does after a successful password check.
 *
 * No Stellar cryptography is performed inside CSS; that responsibility stays
 * entirely with the provisioner. CSS only needs the shared HMAC secret to
 * authenticate its callback to the provisioner.
 */

import { createHmac } from 'node:crypto'
import {
  ResolveLoginHandler,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} from '@solid/community-server'

// CSS generic types require explicit arguments at the usage site.
// We use `any` here because the generic parameters are CSS-internal
// implementation details that change across minor versions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAccountStore = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCookieStore = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAccountStorage = any

/** Storage type constant used by BaseWebIdStore (CSS v7.1.x). */
const WEBID_LINK_TYPE = 'webIdLink'

/** Audience claim sent in every verify callback. */
const STELLAR_AUTH_AUDIENCE = 'nz-css-stellar-login-v1'

/** Max ms before we give up waiting for the provisioner to respond. */
const VERIFY_TIMEOUT_MS = 8_000

interface VerifyResponse {
  valid: boolean
  webId?: string
}

interface WebIdLinkRecord {
  id: string
  webId: string
  accountId: string
}

// The CSS base class uses `JsonInteractionHandlerInput` which has `json: unknown`.
// We use a generic input type that is compatible at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInteractionInput = any

/**
 * Derives the HMAC-SHA256 authentication header value for a provisioner
 * verify callback.  The signed message is `token:audience` so the provisioner
 * can verify both fields in one step.
 */
function computeCallbackHmac(sharedSecret: string, token: string): string {
  return createHmac('sha256', sharedSecret)
    .update(`${token}:${STELLAR_AUTH_AUDIENCE}`)
    .digest('hex')
}

/**
 * Returns `true` when the raw `tokenVerifyUrl` value originates from one of
 * the trusted provisioner origins.  Rejects anything that is not a valid HTTPS
 * URL or whose origin is not in the allowlist (local http allowed for dev).
 */
function isTrustedVerifyUrl(raw: string, allowedOrigins: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }

  const isLocal =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  const protocolAllowed =
    parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocal)
  if (!protocolAllowed) return false

  return allowedOrigins.some((origin) => parsed.origin === origin)
}

export class StellarLoginHandler extends ResolveLoginHandler {
  private readonly accountStorage: AnyAccountStorage
  private readonly allowedOrigins: readonly string[]
  private readonly sharedSecret: string

  /**
   * Positional constructor so Components.js can inject args without
   * om:ObjectMapping (which has URI matching issues with custom prefixes).
   * Mirrors the ResolveLoginHandler base-class positional convention.
   */
  constructor(
    accountStore: AnyAccountStore,
    cookieStore: AnyCookieStore,
    accountStorage: AnyAccountStorage,
  ) {
    super(accountStore, cookieStore)
    this.accountStorage = accountStorage
    const origins = (process.env.NZ_STELLAR_AUTH_PROVISIONER_ORIGINS ?? '').trim()
    this.allowedOrigins = origins.split(',').map((s) => s.trim()).filter(Boolean)
    this.sharedSecret = (process.env.NZ_STELLAR_AUTH_SHARED_SECRET ?? '').trim()
  }

  /** Describes the expected input shape for the CSS account API schema endpoint. */
  async getView(): Promise<{ json: Record<string, unknown> }> {
    return {
      json: {
        fields: {
          loginToken: { type: 'string', required: true },
          tokenVerifyUrl: { type: 'string', required: true },
        },
      },
    }
  }

  /**
   * Validates the Stellar login token via the provisioner, resolves the
   * corresponding CSS account ID, and returns it so the base class can mint
   * the session cookie.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async login(input: AnyInteractionInput): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const json: Record<string, unknown> = input.json ?? {}
    const loginToken = json.loginToken
    const tokenVerifyUrl = json.tokenVerifyUrl

    if (typeof loginToken !== 'string' || !loginToken.trim()) {
      throw Object.assign(new Error('loginToken is required.'), { statusCode: 400 })
    }
    if (typeof tokenVerifyUrl !== 'string' || !tokenVerifyUrl.trim()) {
      throw Object.assign(new Error('tokenVerifyUrl is required.'), { statusCode: 400 })
    }
    if (!isTrustedVerifyUrl(tokenVerifyUrl, this.allowedOrigins)) {
      throw Object.assign(
        new Error('tokenVerifyUrl origin is not in the trusted provisioner allowlist.'),
        { statusCode: 400 },
      )
    }

    // --- Step 1: call provisioner to validate the Stellar-signed token -------
    const hmac = computeCallbackHmac(this.sharedSecret, loginToken.trim())
    let verifyResult: VerifyResponse
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
      const resp = await fetch(tokenVerifyUrl.trim(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-nz-stellar-auth': hmac,
        },
        body: JSON.stringify({ token: loginToken.trim(), audience: STELLAR_AUTH_AUDIENCE }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))

      if (!resp.ok) {
        throw Object.assign(new Error(`Provisioner verify returned ${resp.status}.`), {
          statusCode: 401,
        })
      }
      verifyResult = (await resp.json()) as VerifyResponse
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ABORT_ERR') {
        throw Object.assign(new Error('Stellar token verification timed out.'), { statusCode: 503 })
      }
      throw err
    }

    if (!verifyResult.valid || typeof verifyResult.webId !== 'string' || !verifyResult.webId.trim()) {
      throw Object.assign(new Error('Stellar token is invalid or has expired.'), { statusCode: 401 })
    }

    // --- Step 2: resolve accountId from webId via internal storage -----------
    const webId = verifyResult.webId.trim()
    const records: WebIdLinkRecord[] = await (
      this.accountStorage as unknown as {
        find: (type: string, filter: Record<string, string>) => Promise<WebIdLinkRecord[]>
      }
    ).find(WEBID_LINK_TYPE, { webId })

    if (!records.length) {
      throw Object.assign(new Error(`No CSS account is linked to WebID <${webId}>.`), {
        statusCode: 401,
      })
    }

    const { accountId } = records[0]
    return { json: { accountId, remember: true } }
  }
}
