import { createHash, randomUUID } from 'node:crypto'
import type {
  BootstrapChallenge,
  BootstrapChallengeRequest,
  ProvisionRequest,
  ProvisionStatus,
} from './types.js'

const CHALLENGE_TTL_MS = Number(process.env.JSS_CHALLENGE_TTL_MS ?? 5 * 60_000)

function randomNonce(): string {
  return randomUUID().replace(/-/g, '')
}

function nowIso(): string {
  return new Date().toISOString()
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms)
}

function hashClaim(fields: Array<string>): string {
  const hash = createHash('sha256')
  for (const field of fields) {
    hash.update(field, 'utf8')
    hash.update('\n', 'utf8')
  }
  return hash.digest('hex')
}

function canonical(input: string): string {
  return input.trim()
}

export class ProvisionStore {
  private challenges = new Map<string, BootstrapChallenge>()
  private jobs = new Map<string, ProvisionStatus>()

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

  createPendingJob(_input: ProvisionRequest): string {
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
  }): void {
    const verifiedAt = nowIso()
    const claimHash = hashClaim([
      payload.handle,
      payload.webId,
      payload.podUrl,
      payload.stellarPublicKey,
      payload.challengeId,
      verifiedAt,
    ])

    this.jobs.set(jobId, {
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
        claimHash,
      },
    })
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
}
