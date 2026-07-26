import { randomUUID } from 'node:crypto'
import { LockboxFactoryProvisioner, type BridgeProofPayload } from './lockboxFactory.js'
import type {
  BootstrapChallenge,
  BootstrapChallengeRequest,
  LockboxProvisioning,
  ProvisionStatus,
  StellarAuthChallenge,
} from './types.js'

const CHALLENGE_TTL_MS = Number(process.env.JSS_CHALLENGE_TTL_MS ?? 5 * 60_000)
const STELLAR_CHALLENGE_TTL_MS = Number(process.env.JSS_STELLAR_CHALLENGE_TTL_MS ?? 5 * 60_000)

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
  private lockboxFactory = new LockboxFactoryProvisioner()
  private stellarChallenges = new Map<string, StellarAuthChallenge>()

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
    bridgeProof?: BridgeProofPayload
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

  // ---------------------------------------------------------------------------
  // Stellar Auth — challenge lifecycle
  // ---------------------------------------------------------------------------

  issueStellarChallenge(input: { stellarPublicKey: string }): StellarAuthChallenge {
    const challenge: StellarAuthChallenge = {
      challengeId: randomUUID(),
      nonce: randomNonce(),
      stellarPublicKey: canonical(input.stellarPublicKey),
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
}
