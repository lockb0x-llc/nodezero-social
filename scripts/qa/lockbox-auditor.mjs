/**
 * Audits recent V3 factory events and validates that every emitted child
 * contract has the complete constructor-written bridge state.
 *
 * Usage:
 *   NZ_ENV_PROFILE=staging-testnet pnpm qa:audit:lockbox
 *
 * Optional overrides:
 *   NZ_LOCKBOX_FACTORY_CONTRACT_ID
 *   NZ_LOCKBOX_AUDIT_LEDGER_WINDOW (default: 1500)
 *   NZ_LOCKBOX_AUDIT_MAX_EVENTS (default: 500)
 */

import { Contract, rpc, scValToNative } from '@stellar/stellar-sdk'

const TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org'
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
const CONTRACT_ID_PATTERN = /^C[A-Z0-9]{55}$/

function readPositiveInteger(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return value
}

function isNonZeroBytes(value) {
  return Buffer.isBuffer(value) && value.length === 32 && value.some((byte) => byte !== 0)
}

function parseV3CreationEvent(event) {
  const value = scValToNative(event.value)
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error('Factory event does not match the V3 BridgeLockboxCreated payload.')
  }

  const [accountCommitment, lockboxId, bridgeFingerprint, version] = value
  if (!isNonZeroBytes(accountCommitment)) {
    throw new Error('Factory event has an invalid account commitment.')
  }
  if (typeof lockboxId !== 'string' || !CONTRACT_ID_PATTERN.test(lockboxId)) {
    throw new Error('Factory event has an invalid child contract ID.')
  }
  if (!isNonZeroBytes(bridgeFingerprint)) {
    throw new Error('Factory event has an invalid bridge fingerprint.')
  }
  if (Number(version) !== 3) {
    throw new Error(`Factory event has unexpected bridge version ${String(version)}.`)
  }

  return lockboxId
}

function readFactoryId() {
  const configured = (
    process.env.NZ_LOCKBOX_FACTORY_CONTRACT_ID ??
    process.env.JSS_LOCKBOX_FACTORY_CONTRACT_ID ??
    ''
  ).trim()
  if (!configured) {
    throw new Error('NZ_LOCKBOX_FACTORY_CONTRACT_ID is required.')
  }
  if (!CONTRACT_ID_PATTERN.test(configured)) {
    throw new Error('NZ_LOCKBOX_FACTORY_CONTRACT_ID must be a valid Soroban contract ID.')
  }
  return configured
}

function assertTestnetEnvironment() {
  const profile = (process.env.NZ_ENV_PROFILE ?? 'staging-testnet').trim()
  if (profile !== 'local' && profile !== 'staging-testnet') {
    throw new Error(
      'The lockbox auditor may only run with local or staging-testnet profile values.'
    )
  }

  const rpcUrl = (
    process.env.NZ_STELLAR_RPC_URL ??
    process.env.JSS_STELLAR_RPC_URL ??
    TESTNET_RPC_URL
  ).trim()
  if (rpcUrl !== TESTNET_RPC_URL) {
    throw new Error(`The lockbox auditor only permits ${TESTNET_RPC_URL}.`)
  }
  return rpcUrl
}

async function listFactoryEvents(server, factoryId, startLedger, maxEvents) {
  const events = []
  let response = await server.getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds: [factoryId] }],
    limit: Math.min(100, maxEvents),
  })

  while (response.events.length > 0) {
    events.push(...response.events)
    if (events.length >= maxEvents) {
      throw new Error(
        `Audit event cap (${String(maxEvents)}) reached; narrow NZ_LOCKBOX_AUDIT_LEDGER_WINDOW.`
      )
    }
    if (response.events.length < 100) break
    response = await server.getEvents({
      cursor: response.cursor,
      filters: [{ type: 'contract', contractIds: [factoryId] }],
      limit: Math.min(100, maxEvents - events.length),
    })
  }

  return events
}

async function assertInitializedBridgeAccount(server, lockboxId) {
  const response = await server.getLedgerEntries(new Contract(lockboxId).getFootprint())
  const entry = response.entries[0]
  const storage = entry?.val?.contractData?.().val().instance().storage()
  const storageEntries = Array.from(storage ?? [])

  // V3 writes all nine immutable bridge fields in its child constructor.
  if (storageEntries.length < 9) {
    throw new Error(
      `Child instance has ${String(storageEntries.length)} storage entries; expected all V3 bridge fields.`
    )
  }
}

async function runAudit() {
  const rpcUrl = assertTestnetEnvironment()
  const factoryId = readFactoryId()
  const ledgerWindow = readPositiveInteger('NZ_LOCKBOX_AUDIT_LEDGER_WINDOW', 1500)
  const maxEvents = readPositiveInteger('NZ_LOCKBOX_AUDIT_MAX_EVENTS', 500)
  const server = new rpc.Server(rpcUrl)

  const network = await server.getNetwork()
  if (network.passphrase !== TESTNET_PASSPHRASE) {
    throw new Error('RPC endpoint is not Stellar Testnet.')
  }

  const latestLedger = await server.getLatestLedger()
  const startLedger = Math.max(1, latestLedger.sequence - ledgerWindow)
  console.log(`[lockbox-audit] Factory: ${factoryId}`)
  console.log(
    `[lockbox-audit] Scanning Testnet ledgers ${String(startLedger)}-${String(latestLedger.sequence)}.`
  )

  const events = await listFactoryEvents(server, factoryId, startLedger, maxEvents)
  if (events.length === 0) {
    console.log('[lockbox-audit] PASS: no V3 child deployments in the audit window.')
    return
  }

  let healthy = 0
  let failed = 0
  for (const event of events) {
    try {
      const lockboxId = parseV3CreationEvent(event)
      await assertInitializedBridgeAccount(server, lockboxId)
      healthy += 1
      console.log(`[lockbox-audit] PASS ${event.id}: ${lockboxId} has immutable V3 bridge state.`)
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[lockbox-audit] DEFECT ${event.id}: ${message}`)
    }
  }

  console.log(
    `[lockbox-audit] Summary: ${String(healthy)} healthy, ${String(failed)} failed, ${String(events.length)} evaluated.`
  )
  if (failed > 0) {
    throw new Error('Lockb0x audit found invalid V3 factory event or child state.')
  }
}

runAudit().catch((error) => {
  console.error(`[lockbox-audit] FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
