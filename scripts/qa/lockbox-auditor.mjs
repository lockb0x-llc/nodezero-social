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
 *   NZ_LOCKBOX_AUDIT_REQUIRE_EVENTS (default: false)
 *   NZ_LOCKBOX_AUDIT_EXPECTED_CHILD_IDS (comma-separated contract IDs)
 *   NZ_LOCKBOX_AUDIT_EVENT_ATTEMPTS (default: 12)
 *   NZ_LOCKBOX_AUDIT_EVENT_RETRY_MS (default: 10000)
 */

import { Contract, rpc, scValToNative } from '@stellar/stellar-sdk'
import { waitForReleaseEvents } from './lockbox-audit-retry.mjs'

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

function readBoolean(name, fallback = false) {
  const raw = process.env[name]
  if (!raw) return fallback
  if (/^(1|true|yes)$/i.test(raw.trim())) return true
  if (/^(0|false|no)$/i.test(raw.trim())) return false
  throw new Error(`${name} must be true or false.`)
}

function readExpectedChildIds() {
  const raw = (process.env.NZ_LOCKBOX_AUDIT_EXPECTED_CHILD_IDS ?? '').trim()
  if (!raw) return new Set()
  const ids = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  for (const id of ids) {
    if (!CONTRACT_ID_PATTERN.test(id)) {
      throw new Error(`NZ_LOCKBOX_AUDIT_EXPECTED_CHILD_IDS contains invalid contract ID ${id}.`)
    }
  }
  return new Set(ids)
}

function parseV3CreationEvent(event) {
  if (!Array.isArray(event.topic) || event.topic.length !== 2) {
    throw new Error('Factory event does not have the expected V3 indexed commitment topic.')
  }

  const indexedCommitment = scValToNative(event.topic[1])
  if (!isNonZeroBytes(indexedCommitment)) {
    throw new Error('Factory event has an invalid indexed account commitment.')
  }

  const value = scValToNative(event.value)
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error('Factory event does not match the V3 BridgeLockboxCreated payload.')
  }

  const [lockboxId, bridgeFingerprint, version] = value
  if (typeof lockboxId !== 'string' || !CONTRACT_ID_PATTERN.test(lockboxId)) {
    throw new Error('Factory event has an invalid child contract ID.')
  }
  if (!isNonZeroBytes(bridgeFingerprint)) {
    throw new Error('Factory event has an invalid bridge fingerprint.')
  }
  if (Number(version) !== 3) {
    throw new Error(`Factory event has unexpected bridge version ${String(version)}.`)
  }

  return { lockboxId, accountCommitment: indexedCommitment }
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
  let response = await withTimeout(
    server.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [factoryId] }],
      limit: Math.min(100, maxEvents),
    }),
    20_000,
    'Stellar event query'
  )

  while (response.events.length > 0) {
    events.push(...response.events)
    if (events.length >= maxEvents) {
      throw new Error(
        `Audit event cap (${String(maxEvents)}) reached; narrow NZ_LOCKBOX_AUDIT_LEDGER_WINDOW.`
      )
    }
    if (response.events.length < 100) break
    response = await withTimeout(
      server.getEvents({
        cursor: response.cursor,
        filters: [{ type: 'contract', contractIds: [factoryId] }],
        limit: Math.min(100, maxEvents - events.length),
      }),
      20_000,
      'Stellar event pagination'
    )
  }

  return events
}

async function withTimeout(promise, timeoutMs, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function assertInitializedBridgeAccount(server, factoryId, eventState) {
  const { lockboxId, accountCommitment } = eventState
  const response = await server.getLedgerEntries(new Contract(lockboxId).getFootprint())
  const entry = response.entries[0]
  const storage = entry?.val?.contractData?.().val().instance().storage()
  const storageEntries = Array.from(storage ?? [])
  const decoded = new Map()
  for (const storageEntry of storageEntries) {
    const key = scValToNative(storageEntry.key())
    if (!Array.isArray(key) || key.length !== 1 || typeof key[0] !== 'string') {
      throw new Error('Child instance contains an invalid constructor storage key.')
    }
    if (decoded.has(key[0])) {
      throw new Error(`Child instance contains duplicate ${key[0]} storage.`)
    }
    decoded.set(key[0], scValToNative(storageEntry.val()))
  }

  const expectedKeys = [
    'AccountCommitment',
    'Ciphertext',
    'CiphertextHash',
    'CircuitVersion',
    'ClaimHash',
    'Factory',
    'Operator',
    'PodBinding',
    'ProofHash',
  ]
  const actualKeys = [...decoded.keys()].sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(
      `Child instance storage keys are incomplete or unexpected: ${actualKeys.join(',')}.`
    )
  }

  if (decoded.get('Factory') !== factoryId) {
    throw new Error('Child Factory storage does not match the audited V3 factory.')
  }
  const operator = decoded.get('Operator')
  if (typeof operator !== 'string' || !/^[GC][A-Z0-9]{55}$/.test(operator)) {
    throw new Error('Child Operator storage is not a valid Stellar address.')
  }
  const storedCommitment = decoded.get('AccountCommitment')
  if (!Buffer.isBuffer(storedCommitment) || !storedCommitment.equals(accountCommitment)) {
    throw new Error('Child AccountCommitment does not match the indexed factory event topic.')
  }
  for (const key of ['PodBinding', 'ClaimHash', 'ProofHash', 'CiphertextHash']) {
    if (!isNonZeroBytes(decoded.get(key))) {
      throw new Error(`Child ${key} storage is not a nonzero 32-byte value.`)
    }
  }
  const ciphertext = decoded.get('Ciphertext')
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length === 0 || ciphertext.length > 4096) {
    throw new Error('Child Ciphertext storage is empty or exceeds 4096 bytes.')
  }
  if (Number(decoded.get('CircuitVersion')) !== 3) {
    throw new Error(`Child CircuitVersion is ${String(decoded.get('CircuitVersion'))}; expected 3.`)
  }
}

async function runAudit() {
  const rpcUrl = assertTestnetEnvironment()
  const factoryId = readFactoryId()
  const ledgerWindow = readPositiveInteger('NZ_LOCKBOX_AUDIT_LEDGER_WINDOW', 1500)
  const maxEvents = readPositiveInteger('NZ_LOCKBOX_AUDIT_MAX_EVENTS', 500)
  const requireEvents = readBoolean('NZ_LOCKBOX_AUDIT_REQUIRE_EVENTS')
  const expectedChildIds = readExpectedChildIds()
  const eventAttempts = readPositiveInteger('NZ_LOCKBOX_AUDIT_EVENT_ATTEMPTS', 12)
  const eventRetryMs = readPositiveInteger('NZ_LOCKBOX_AUDIT_EVENT_RETRY_MS', 10_000)
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

  const events = await waitForReleaseEvents({
    loadEvents: () => listFactoryEvents(server, factoryId, startLedger, maxEvents),
    expectedChildIds,
    requireEvents,
    attempts: eventAttempts,
    delayMs: eventRetryMs,
    readChildId: (event) => parseV3CreationEvent(event).lockboxId,
    onRetry: ({ attempt, attempts, eventCount, missingExpected }) => {
      console.log(
        `[lockbox-audit] Event index not converged (${String(eventCount)} events, ` +
          `${String(missingExpected.length)} expected children missing); retry ` +
          `${String(attempt)}/${String(attempts)}.`
      )
    },
  })
  if (events.length === 0) {
    if (requireEvents || expectedChildIds.size > 0) {
      throw new Error('No V3 child deployments were found in a release audit that requires events.')
    }
    console.log('[lockbox-audit] PASS: no V3 child deployments in the audit window.')
    return
  }

  let healthy = 0
  let failed = 0
  const auditedChildIds = new Set()
  for (const event of events) {
    try {
      const eventState = parseV3CreationEvent(event)
      await assertInitializedBridgeAccount(server, factoryId, eventState)
      auditedChildIds.add(eventState.lockboxId)
      healthy += 1
      console.log(
        `[lockbox-audit] PASS ${event.id}: ${eventState.lockboxId} has exact immutable V3 bridge state.`
      )
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
  const missingExpected = [...expectedChildIds].filter((id) => !auditedChildIds.has(id))
  if (missingExpected.length > 0) {
    throw new Error(
      `Expected V3 child contracts were not found in the audit window: ${missingExpected.join(',')}`
    )
  }
}

runAudit().catch((error) => {
  console.error(`[lockbox-audit] FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
