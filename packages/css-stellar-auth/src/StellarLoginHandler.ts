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
  BadRequestHttpError,
  UnauthorizedHttpError,
  InternalServerError,
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
type AnyWebIdStore = any

/** Audience claim sent in every verify callback. */
const STELLAR_AUTH_AUDIENCE = 'nz-css-stellar-login-v1'

/** Max ms before we give up waiting for the provisioner to respond. */
const VERIFY_TIMEOUT_MS = 8_000

interface VerifyResponse {
  valid: boolean
  webId?: string
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
  private readonly webIdStore: AnyWebIdStore
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
    webIdStore: AnyWebIdStore,
  ) {
    super(accountStore, cookieStore)
    this.webIdStore = webIdStore
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
    try {
      return await this.doLogin(input)
    } catch (err: unknown) {
      // Re-throw proper CSS HttpError instances directly; wrap unknown errors
      if (err && typeof err === 'object' && err instanceof Error &&
          ('statusCode' in err || err.constructor.name.endsWith('HttpError'))) throw err
      throw new InternalServerError(err instanceof Error ? err.message : 'Stellar login failed.')
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async doLogin(input: AnyInteractionInput): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const json: Record<string, unknown> = input.json ?? {}
    const loginToken = json.loginToken
    const tokenVerifyUrl = json.tokenVerifyUrl

    if (typeof loginToken !== 'string' || !loginToken.trim()) {
      throw new BadRequestHttpError('loginToken is required.')
    }
    if (typeof tokenVerifyUrl !== 'string' || !tokenVerifyUrl.trim()) {
      throw new BadRequestHttpError('tokenVerifyUrl is required.')
    }
    if (!isTrustedVerifyUrl(tokenVerifyUrl, this.allowedOrigins)) {
      throw new BadRequestHttpError('tokenVerifyUrl origin is not in the trusted provisioner allowlist.')
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
        throw new UnauthorizedHttpError(`Provisioner verify returned ${resp.status}.`)
      }
      verifyResult = (await resp.json()) as VerifyResponse
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ABORT_ERR') {
        throw new InternalServerError('Stellar token verification timed out.')
      }
      throw err
    }

    if (!verifyResult.valid || typeof verifyResult.webId !== 'string' || !verifyResult.webId.trim()) {
      throw new UnauthorizedHttpError('Stellar token is invalid or has expired.')
    }

    // --- Step 2: resolve accountId from webId via WebIdStore storage ---------
    const webId = verifyResult.webId.trim()

    // CSS v7 WebIdStore public interface only exposes findLinks(accountId) and
    // isLinked(webId, accountId) — neither lets us derive accountId from webId
    // alone.  BaseWebIdStore (the runtime implementation) delegates to an
    // internal AccountLoginStorage instance that stores webId link records as
    // { id, webId, accountId } tuples under the type key 'webIdLink'.
    //
    // We access the internal `storage.find()` via a dynamic property lookup so
    // that this handler does not depend on CSS private APIs in TypeScript but
    // still works correctly against the running CSS instance.
    let accountId: string | undefined
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const internalStorage = (this.webIdStore as Record<string, unknown>)['storage']
      if (
        internalStorage &&
        typeof internalStorage === 'object' &&
        typeof (internalStorage as Record<string, unknown>)['find'] === 'function'
      ) {
        type LinkRecord = { id: string; webId: string; accountId: string }
        const links = await (internalStorage as { find: (type: string, filter: Record<string, string>) => Promise<LinkRecord[]> }).find('webIdLink', { webId })
        accountId = links[0]?.accountId
      }
    } catch {
      accountId = undefined
    }

    if (!accountId) {
      throw new UnauthorizedHttpError(`No CSS account is linked to WebID <${webId}>.`)
    }

    return { json: { accountId, remember: true } }
  }
}
