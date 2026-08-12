import { randomUUID } from 'node:crypto'
import { LockboxFactoryProvisioner, type BridgeProofPayload } from './lockboxFactory.js'
import type { LockboxProvisioning, StellarAuthChallenge } from './types.js'

const STELLAR_CHALLENGE_TTL_MS = Number(process.env.JSS_STELLAR_CHALLENGE_TTL_MS ?? 5 * 60_000)

function randomNonce(): string {
  return randomUUID().replace(/-/g, '')
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms)
}

function canonical(input: string): string {
  return input.trim()
}

export class ProvisionStore {
  private lockboxFactory = new LockboxFactoryProvisioner()
  private stellarChallenges = new Map<string, StellarAuthChallenge>()

  async provisionLockbox(input: {
    webId: string
    stellarPublicKey: string
    podBindingHash: string
    proofRootHex: string
    bridgeProof?: BridgeProofPayload
  }): Promise<LockboxProvisioning> {
    return this.lockboxFactory.provision(input)
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
