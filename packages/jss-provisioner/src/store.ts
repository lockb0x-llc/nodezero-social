import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { LockboxFactoryProvisioner } from './lockboxFactory.js'
import type {
  BootstrapChallenge,
  BootstrapChallengeRequest,
  LockboxProvisioning,
  OidcBridgeTicket,
  ProvisionStatus,
  StellarAuthChallenge,
  StellarLoginToken,
} from './types.js'

const CHALLENGE_TTL_MS = Number(process.env.JSS_CHALLENGE_TTL_MS ?? 5 * 60_000)
const STELLAR_CHALLENGE_TTL_MS = Number(process.env.JSS_STELLAR_CHALLENGE_TTL_MS ?? 5 * 60_000)
const STELLAR_TOKEN_TTL_MS = Number(process.env.JSS_STELLAR_TOKEN_TTL_MS ?? 10 * 60_000)

function resolveOidcBridgeTtlMs(): number {
  const raw = Number(process.env.JSS_OIDC_BRIDGE_TTL_MS ?? 15 * 60_000)
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60_000
}

interface OidcBridgeRecord {
  token: string
  email: string
  password: string
  webId: string
  podUrl: string
  audience: string
  consumerOrigin: string
  issuer: string
  expiresAt: string
}

function randomNonce(): string {
  return randomUUID().replace(/-/g, '')
}

function nowIso(): string {
  return new Date().toISOString()
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms)
}

function canonical(input: string): string {
  return input.trim()
}

export class ProvisionStore {
  private challenges = new Map<string, BootstrapChallenge>()
  private jobs = new Map<string, ProvisionStatus>()
  private oidcBridgeTickets = new Map<string, OidcBridgeRecord>()
  private oidcBridgeTtlMs = resolveOidcBridgeTtlMs()
  private lockboxFactory = new LockboxFactoryProvisioner()
  private stellarChallenges = new Map<string, StellarAuthChallenge>()
  private stellarLoginTokens = new Map<string, StellarLoginToken>()

  issueChallenge(input: BootstrapChallengeRequest): BootstrapChallenge {
    const now = new Date()
    const challenge: BootstrapChallenge = {
      challengeId: randomUUID(),
      nonce: randomNonce(),
      domain: process.env.JSS_ATTESTATION_DOMAIN ?? 'staging.nodezero.social',
      expiresAt: addMs(now, CHALLENGE_TTL_MS).toISOString(),
      envProfile: process.env.NZ_ENV_PROFILE ?? 'local',
      handle: canonical(input.handle),
      webId: canonical(input.webId),
      podUrl: canonical(input.podUrl),
    }

    this.challenges.set(challenge.challengeId, challenge)
    return challenge
  }

  consumeChallenge(challengeId: string): BootstrapChallenge | null {
    const challenge = this.challenges.get(challengeId) ?? null
    if (!challenge) return null
    this.challenges.delete(challengeId)

    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      return null
    }

    return challenge
  }

  createPendingJob(): string {
    const jobId = randomUUID()
    this.jobs.set(jobId, {
      status: 'pending',
      jobId,
    })
    return jobId
  }

  resolveJob(jobId: string, payload: {
    handle: string
    webId: string
    podUrl: string
    issuer: string
    stellarPublicKey: string
    challengeId: string
    claimHash: string
    proofHashHex: string
    proofRootHex: string
    lockbox?: LockboxProvisioning
  }): void {
    const verifiedAt = nowIso()

    const status: ProvisionStatus = {
      status: 'ready',
      jobId,
      user: {
        handle: payload.handle,
        webId: payload.webId,
        podUrl: payload.podUrl,
        issuer: payload.issuer,
        stellarPublicKey: payload.stellarPublicKey,
      },
      custodyReceipt: {
        challengeId: payload.challengeId,
        verifiedAt,
        claimHash: payload.claimHash,
        proofHashHex: payload.proofHashHex,
        proofRootHex: payload.proofRootHex,
      },
    }

    if (payload.lockbox) {
      status.lockbox = payload.lockbox
    }

    this.jobs.set(jobId, status)
  }

  async provisionLockbox(input: {
    webId: string
    stellarPublicKey: string
    podBindingHash: string
    proofRootHex: string
  }): Promise<LockboxProvisioning> {
    return this.lockboxFactory.provision(input)
  }

  failJob(jobId: string, error: string): void {
    this.jobs.set(jobId, {
      status: 'error',
      jobId,
      error,
    })
  }

  getJob(jobId: string): ProvisionStatus | null {
    return this.jobs.get(jobId) ?? null
  }

  issueOidcBridgeTicket(input: {
    email: string
    password: string
    webId: string
    podUrl: string
    audience: string
    consumerOrigin: string
    issuer: string
  }): OidcBridgeTicket {
    const now = new Date()
    const ticket: OidcBridgeRecord = {
      token: randomNonce(),
      email: canonical(input.email),
      password: input.password,
      webId: canonical(input.webId),
      podUrl: canonical(input.podUrl),
      audience: canonical(input.audience),
      consumerOrigin: canonical(input.consumerOrigin),
      issuer: canonical(input.issuer),
      expiresAt: addMs(now, this.oidcBridgeTtlMs).toISOString(),
    }

    this.oidcBridgeTickets.set(ticket.token, ticket)
    return {
      token: ticket.token,
      expiresAt: ticket.expiresAt,
    }
  }

  consumeOidcBridgeTicket(input: {
    token: string
    audience: string
    consumerOrigin: string
    issuer: string
  }): OidcBridgeRecord | null {
    const key = canonical(input.token)
    const ticket = this.oidcBridgeTickets.get(key) ?? null
    if (!ticket) return null

    if (ticket.audience !== canonical(input.audience)) {
      return null
    }
    if (ticket.consumerOrigin !== canonical(input.consumerOrigin)) {
      return null
    }
    if (ticket.issuer !== canonical(input.issuer)) {
      return null
    }

    this.oidcBridgeTickets.delete(key)
    if (new Date(ticket.expiresAt).getTime() < Date.now()) {
      return null
    }

    return ticket
  }

  // ---------------------------------------------------------------------------
  // Stellar Auth — challenge / token lifecycle
  // ---------------------------------------------------------------------------

  issueStellarChallenge(input: { stellarPublicKey: string; webId: string }): StellarAuthChallenge {
    const challenge: StellarAuthChallenge = {
      challengeId: randomUUID(),
      nonce: randomNonce(),
      stellarPublicKey: canonical(input.stellarPublicKey),
      webId: canonical(input.webId),
      expiresAt: addMs(new Date(), STELLAR_CHALLENGE_TTL_MS).toISOString(),
    }
    this.stellarChallenges.set(challenge.challengeId, challenge)
    return challenge
  }

  consumeStellarChallenge(challengeId: string): StellarAuthChallenge | null {
    const challenge = this.stellarChallenges.get(challengeId) ?? null
    if (!challenge) return null
    this.stellarChallenges.delete(challengeId)
    if (new Date(challenge.expiresAt).getTime() < Date.now()) return null
    return challenge
  }

  issueStellarLoginToken(webId: string): StellarLoginToken {
    const token: StellarLoginToken = {
      tokenId: randomUUID(),
      webId: canonical(webId),
      expiresAt: addMs(new Date(), STELLAR_TOKEN_TTL_MS).toISOString(),
    }
    this.stellarLoginTokens.set(token.tokenId, token)
    return token
  }

  /**
   * Validates the CSS plugin's HMAC-authenticated verify request and returns
   * the webId for the token. Single-use: the token is deleted on success.
   *
   * @param tokenId    The raw UUID token value sent by the CSS plugin.
   * @param audience   Must equal 'nz-css-stellar-login-v1'.
   * @param hmacHeader The `x-nz-stellar-auth` header value from the CSS request.
   * @param sharedSecret The HMAC key configured in both the CSS plugin and here.
   */
  consumeStellarLoginToken(input: {
    tokenId: string
    audience: string
    hmacHeader: string
    sharedSecret: string
  }): { webId: string } | null {
    const expectedAudience = 'nz-css-stellar-login-v1'
    if (canonical(input.audience) !== expectedAudience) return null

    // Verify HMAC — the CSS plugin signs `tokenId:audience` with the shared secret.
    const expectedHmac = createHmac('sha256', input.sharedSecret)
      .update(`${canonical(input.tokenId)}:${expectedAudience}`)
      .digest('hex')
    const providedHmac = Buffer.from(canonical(input.hmacHeader), 'utf8')
    const expectedBuf = Buffer.from(expectedHmac, 'utf8')
    if (
      providedHmac.length !== expectedBuf.length ||
      !timingSafeEqual(providedHmac, expectedBuf)
    ) {
      return null
    }

    const record = this.stellarLoginTokens.get(canonical(input.tokenId)) ?? null
    if (!record) return null
    this.stellarLoginTokens.delete(canonical(input.tokenId))
    if (new Date(record.expiresAt).getTime() < Date.now()) return null

    return { webId: record.webId }
  }
}
