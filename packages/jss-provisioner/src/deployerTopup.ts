/**
 * @module deployerTopup
 *
 * Pre-flight Treasury -> Deployer top-up for the two-account funding model.
 *
 * Account topology:
 *  - TREASURY  (`JSS_TREASURY_SOURCE_ACCOUNT`): canonical money source. Funds
 *    member account creation, pays fee-bumps, and tops up the Deployer.
 *  - DEPLOYER  (`JSS_DEPLOYER_SOURCE_ACCOUNT`): the lockb0x factory operator that
 *    deploys + initializes per-user lockb0x contracts and pays their gas from its
 *    own balance.
 *
 * Invariant (per product directive): before EVERY new lockb0x creation, ensure
 * the Deployer holds at least `JSS_DEPLOYER_MIN_XLM` (default 50) TestNet XLM.
 * If it is below the floor, the Treasury tops it up to the floor before the
 * factory call proceeds. Fail-closed: if the top-up cannot complete, the caller
 * must NOT attempt lockb0x creation.
 *
 * Zero runtime dependencies: uses only Node built-ins, the `stellar` CLI, and
 * the Horizon REST API via global `fetch` (the provisioner ships without
 * node_modules, so no SDK may be imported).
 */

import { spawn } from 'node:child_process'

const HORIZON_URL = (process.env.JSS_HORIZON_URL ?? 'https://horizon-testnet.stellar.org').replace(/\/+$/, '')
const MIN_DEPLOYER_XLM = Number(process.env.JSS_DEPLOYER_MIN_XLM ?? '50')
const NETWORK = process.env.JSS_STELLAR_NETWORK ?? process.env.STELLAR_NETWORK ?? 'testnet'
const STROOPS_PER_XLM = 10_000_000

/** Resolves the Deployer CLI alias (falls back to the legacy single source account). */
export function getDeployerSourceAccount(): string {
  return (
    process.env.JSS_DEPLOYER_SOURCE_ACCOUNT ??
    process.env.JSS_STELLAR_SOURCE_ACCOUNT ??
    ''
  ).trim()
}

/** Resolves the Treasury CLI alias (falls back to the legacy single source account). */
export function getTreasurySourceAccount(): string {
  return (
    process.env.JSS_TREASURY_SOURCE_ACCOUNT ??
    process.env.JSS_STELLAR_SOURCE_ACCOUNT ??
    ''
  ).trim()
}

function runStellar(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn('stellar', args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    proc.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      reject(new Error(stderr.trim() || `stellar exited with code ${String(code)}`))
    })
  })
}

/** Returns the G... public key for a stellar CLI key alias. */
async function resolvePublicKey(alias: string): Promise<string> {
  const out = await runStellar(['keys', 'public-key', alias])
  const match = out.match(/G[A-Z2-7]{55}/)
  if (!match) {
    throw new Error(`Could not resolve public key for stellar key alias '${alias}'.`)
  }
  return match[0]
}

/** Reads the native (XLM) balance for a public key via Horizon. Returns 0 when the account does not yet exist. */
async function getNativeBalance(publicKey: string): Promise<number> {
  const res = await fetch(`${HORIZON_URL}/accounts/${encodeURIComponent(publicKey)}`)
  if (res.status === 404) return 0
  if (!res.ok) {
    throw new Error(`Horizon account lookup failed (${res.status}) for ${publicKey}.`)
  }
  const body = (await res.json()) as { balances?: Array<{ asset_type: string; balance: string }> }
  const native = body.balances?.find((entry) => entry.asset_type === 'native')
  return native ? Number(native.balance) : 0
}

/** Sends a Treasury-signed native payment of `amountXlm` to `destinationPublicKey`. */
async function treasuryPayment(
  treasuryAlias: string,
  destinationPublicKey: string,
  amountXlm: number,
): Promise<void> {
  // Amount is expressed in whole XLM with up to 7 decimal places for the CLI.
  const amount = (Math.ceil(amountXlm * STROOPS_PER_XLM) / STROOPS_PER_XLM).toFixed(7)
  await runStellar([
    'tx',
    'new',
    'payment',
    '--source-account',
    treasuryAlias,
    '--network',
    NETWORK,
    '--destination',
    destinationPublicKey,
    '--asset',
    'native',
    '--amount',
    String(Math.ceil(amountXlm * STROOPS_PER_XLM)),
  ]).catch((err: unknown) => {
    // Surface a clear, actionable error; the caller fails closed.
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Treasury top-up payment of ${amount} XLM to Deployer failed: ${message}`)
  })
}

/**
 * Ensures the Deployer holds at least the configured minimum XLM, topping it up
 * from the Treasury when required. Throws (fail-closed) when the Deployer/Treasury
 * are unconfigured or the top-up cannot be completed.
 *
 * @returns Diagnostic detail about the balance and any top-up performed.
 */
export async function ensureDeployerFunded(): Promise<{
  deployerPublicKey: string
  balanceBefore: number
  toppedUp: boolean
  topUpAmountXlm: number
  minXlm: number
}> {
  const deployerAlias = getDeployerSourceAccount()
  if (!deployerAlias) {
    throw new Error('Deployer source account is not configured (JSS_DEPLOYER_SOURCE_ACCOUNT).')
  }

  const deployerPublicKey = await resolvePublicKey(deployerAlias)
  const balanceBefore = await getNativeBalance(deployerPublicKey)

  if (balanceBefore >= MIN_DEPLOYER_XLM) {
    return {
      deployerPublicKey,
      balanceBefore,
      toppedUp: false,
      topUpAmountXlm: 0,
      minXlm: MIN_DEPLOYER_XLM,
    }
  }

  const treasuryAlias = getTreasurySourceAccount()
  if (!treasuryAlias) {
    throw new Error('Treasury source account is not configured (JSS_TREASURY_SOURCE_ACCOUNT).')
  }

  const topUpAmountXlm = Number((MIN_DEPLOYER_XLM - balanceBefore).toFixed(7))
  await treasuryPayment(treasuryAlias, deployerPublicKey, topUpAmountXlm)

  return {
    deployerPublicKey,
    balanceBefore,
    toppedUp: true,
    topUpAmountXlm,
    minXlm: MIN_DEPLOYER_XLM,
  }
}
