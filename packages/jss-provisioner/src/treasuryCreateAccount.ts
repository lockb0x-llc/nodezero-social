/**
 * @module treasuryCreateAccount
 *
 * P3 — Treasury-sponsored member account creation.
 *
 * On MainNet there is no Friendbot, so a member's Stellar account must be
 * created and funded by the NodeZero Treasury before any user-authored on-chain
 * operation (e.g. `register_webid`). This module performs a plain, idempotent
 * `CreateAccount` signed and paid for entirely by the Treasury, so the member
 * spends none of their own funds and needs no pre-existing account.
 *
 * Security posture:
 *  - Idempotent: if the destination already exists, this is a no-op (the
 *    Treasury is never charged twice for the same account).
 *  - Bounded: the starting balance is clamped to `JSS_MEMBER_STARTING_XLM`
 *    (default 1 XLM) and hard-capped at `MAX_STARTING_XLM` so a caller can
 *    never request an unbounded Treasury drain.
 *  - Fail-closed: throws when the Treasury alias is unconfigured or the CLI
 *    submission fails; callers must not proceed as if the account exists.
 *
 * Zero runtime dependencies: uses only the shared `stellar` CLI helpers and the
 * Horizon REST API (no `@stellar/stellar-sdk`).
 */

import { accountExists, getTreasurySourceAccount, NETWORK, runStellar, STROOPS_PER_XLM } from './stellarCli.js'

/** Absolute ceiling on a single sponsored starting balance, regardless of config. */
const MAX_STARTING_XLM = Number(process.env.JSS_MEMBER_STARTING_MAX_XLM ?? '2')
/** Default sponsored starting balance for a new member account. */
const DEFAULT_STARTING_XLM = Number(process.env.JSS_MEMBER_STARTING_XLM ?? '1')
const CREATE_ACCOUNT_RETRY_ATTEMPTS = Number(
  process.env.JSS_TREASURY_CREATE_ACCOUNT_RETRY_ATTEMPTS ?? '3'
)
const CREATE_ACCOUNT_RETRY_BASE_DELAY_MS = Number(
  process.env.JSS_TREASURY_CREATE_ACCOUNT_RETRY_BASE_DELAY_MS ?? '1000'
)

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/

export interface TreasuryCreateAccountResult {
  destination: string
  alreadyExisted: boolean
  created: boolean
  startingBalanceXlm: number
  txHash: string | null
}

interface TreasuryCreateAccountDependencies {
  accountExists: typeof accountExists
  getTreasurySourceAccount: typeof getTreasurySourceAccount
  runStellar: typeof runStellar
  sleep: (ms: number) => Promise<void>
  retryAttempts: number
  retryBaseDelayMs: number
}

const defaultDependencies: TreasuryCreateAccountDependencies = {
  accountExists,
  getTreasurySourceAccount,
  runStellar,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  retryAttempts: CREATE_ACCOUNT_RETRY_ATTEMPTS,
  retryBaseDelayMs: CREATE_ACCOUNT_RETRY_BASE_DELAY_MS,
}

function isTransientStellarTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /client error \(connect\)|connection (?:reset|refused)|timed? out/i.test(message)
}

/**
 * Ensures `destinationPublicKey` exists on-chain, funding it from the Treasury
 * with a plain `CreateAccount` when absent.
 *
 * @param destinationPublicKey - The member's Stellar public key (G...).
 * @param requestedStartingXlm - Optional starting balance; clamped to the
 *   configured bounds. Defaults to `JSS_MEMBER_STARTING_XLM`.
 */
export async function treasuryCreateAccount(
  destinationPublicKey: string,
  requestedStartingXlm?: number,
  dependencyOverrides: Partial<TreasuryCreateAccountDependencies> = {},
): Promise<TreasuryCreateAccountResult> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }
  const destination = (destinationPublicKey ?? '').trim()
  if (!STELLAR_PUBLIC_KEY.test(destination)) {
    throw new Error('destination must be a valid Stellar public key (G...).')
  }

  // Clamp the starting balance to [0, MAX_STARTING_XLM] to prevent Treasury drain.
  const requested = Number.isFinite(requestedStartingXlm) ? Number(requestedStartingXlm) : DEFAULT_STARTING_XLM
  const startingBalanceXlm = Math.min(Math.max(requested, 0), MAX_STARTING_XLM)
  if (startingBalanceXlm <= 0) {
    throw new Error('startingBalance must be greater than 0 XLM.')
  }

  // Idempotent: never re-create (and never re-charge the Treasury for) an
  // account that already exists on-chain.
  if (await dependencies.accountExists(destination)) {
    return { destination, alreadyExisted: true, created: false, startingBalanceXlm: 0, txHash: null }
  }

  const treasuryAlias = dependencies.getTreasurySourceAccount()
  if (!treasuryAlias) {
    throw new Error('Treasury source account is not configured (JSS_TREASURY_SOURCE_ACCOUNT).')
  }

  const startingStroops = Math.round(startingBalanceXlm * STROOPS_PER_XLM)
  const args = [
    'tx',
    'new',
    'create-account',
    '--source-account',
    treasuryAlias,
    '--network',
    NETWORK,
    '--destination',
    destination,
    '--starting-balance',
    String(startingStroops),
  ]
  const attempts = Math.max(1, Math.floor(dependencies.retryAttempts))
  let output = ''
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      output = await dependencies.runStellar(args)
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!isTransientStellarTransportError(error)) {
        throw new Error(
          `Treasury CreateAccount for ${destination} (${startingBalanceXlm} XLM) failed: ${message}`
        )
      }
      if (await dependencies.accountExists(destination)) {
        return {
          destination,
          alreadyExisted: true,
          created: false,
          startingBalanceXlm: 0,
          txHash: null,
        }
      }
      if (attempt === attempts) {
        throw new Error(
          `Treasury CreateAccount for ${destination} (${startingBalanceXlm} XLM) failed after ${attempts} attempts: ${message}`
        )
      }
      await dependencies.sleep(Math.max(0, dependencies.retryBaseDelayMs) * attempt)
    }
  }

  const txHash = output.match(/[0-9a-f]{64}/i)?.[0] ?? null
  return { destination, alreadyExisted: false, created: true, startingBalanceXlm, txHash }
}
