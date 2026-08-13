/**
 * @module stellarCli
 *
 * Shared, zero-dependency helpers for driving the `stellar` CLI and reading
 * Horizon. The provisioner ships without `node_modules` (deployed as a bare
 * dist + package.json zip), so no `@stellar/stellar-sdk` import is permitted
 * anywhere in this package — all chain interaction goes through the `stellar`
 * CLI binary and the Horizon/Soroban REST APIs via global `fetch`.
 */

import { spawn } from 'node:child_process'

export const HORIZON_URL = (
  process.env.JSS_HORIZON_URL ?? 'https://horizon-testnet.stellar.org'
).replace(/\/+$/, '')
export const NETWORK = process.env.JSS_STELLAR_NETWORK ?? process.env.STELLAR_NETWORK ?? 'testnet'
export const STROOPS_PER_XLM = 10_000_000

/** Runs the `stellar` CLI with the given args and resolves trimmed stdout (rejects on non-zero exit). */
export function runStellar(args: string[]): Promise<string> {
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
export async function resolvePublicKey(alias: string): Promise<string> {
  const out = await runStellar(['keys', 'public-key', alias])
  const match = out.match(/G[A-Z2-7]{55}/)
  if (!match) {
    throw new Error(`Could not resolve public key for stellar key alias '${alias}'.`)
  }
  return match[0]
}

/** Reads the native (XLM) balance for a public key via Horizon. Returns 0 when the account does not yet exist. */
export async function getNativeBalance(publicKey: string): Promise<number> {
  const res = await fetch(`${HORIZON_URL}/accounts/${encodeURIComponent(publicKey)}`)
  if (res.status === 404) return 0
  if (!res.ok) {
    throw new Error(`Horizon account lookup failed (${res.status}) for ${publicKey}.`)
  }
  const body = (await res.json()) as { balances?: Array<{ asset_type: string; balance: string }> }
  const native = body.balances?.find((entry) => entry.asset_type === 'native')
  return native ? Number(native.balance) : 0
}

/** True when the account exists (is funded) on Horizon. */
export async function accountExists(publicKey: string): Promise<boolean> {
  const res = await fetch(`${HORIZON_URL}/accounts/${encodeURIComponent(publicKey)}`)
  if (res.status === 404) return false
  if (!res.ok) {
    throw new Error(`Horizon account lookup failed (${res.status}) for ${publicKey}.`)
  }
  return true
}

/** Resolves the Deployer CLI alias (defaults to the shared source account when unset). */
export function getDeployerSourceAccount(): string {
  return (
    process.env.JSS_DEPLOYER_SOURCE_ACCOUNT ??
    process.env.JSS_STELLAR_SOURCE_ACCOUNT ??
    ''
  ).trim()
}

/** Resolves the Treasury CLI alias (defaults to the shared source account when unset). */
export function getTreasurySourceAccount(): string {
  return (
    process.env.JSS_TREASURY_SOURCE_ACCOUNT ??
    process.env.JSS_STELLAR_SOURCE_ACCOUNT ??
    ''
  ).trim()
}
