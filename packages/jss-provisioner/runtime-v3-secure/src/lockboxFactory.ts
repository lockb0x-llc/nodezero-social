import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { LockboxProvisioning } from './types.js'
import { ensureDeployerFunded, getDeployerSourceAccount } from './deployerTopup.js'

type FactoryMode = 'mock' | 'disabled' | 'soroban'

export interface BridgeProofPayload {
  proofHex: string
  proofHashHex: string
  claimHashHex: string
  accountCommitmentHex: string
  podBindingHex: string
  ciphertextHex: string
  circuitVersion: number
}

const DEFAULT_RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const DEFAULT_NETWORK = process.env.STELLAR_NETWORK ?? 'testnet'

function canonical(input: string): string {
  return input.trim()
}

function toBytes32Hex(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex')
}

function parseFactoryMode(raw: string): FactoryMode {
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'disabled') return 'disabled'
  if (normalized === 'soroban') return 'soroban'
  return 'mock'
}

function firstContractId(value: string): string | null {
  const match = value.match(/C[A-Z0-9]{55}/)
  return match ? match[0] : null
}

function firstHex64(value: string): string | null {
  const match = value.match(/\b[a-fA-F0-9]{64}\b/)
  return match ? match[0].toLowerCase() : null
}

function normalizeHex(value: string, label: string, length: number): string {
  const normalized = value.trim().toLowerCase().replace(/^0x/, '')
  if (!new RegExp(`^[0-9a-f]{${String(length)}}$`).test(normalized)) {
    throw new Error(`${label} must be ${String(length / 2)} bytes of hex.`)
  }
  return normalized
}

function normalizeBoundedHex(value: string, label: string, maximumBytes: number): string {
  const normalized = value.trim().toLowerCase().replace(/^0x/, '')
  if (
    normalized.length === 0 ||
    normalized.length % 2 !== 0 ||
    normalized.length > maximumBytes * 2 ||
    !/^[0-9a-f]+$/.test(normalized)
  ) {
    throw new Error(`${label} must be non-empty, even-length hex up to ${String(maximumBytes)} bytes.`)
  }
  return normalized
}

async function runStellarInvoke(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn('stellar', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

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

    proc.on('error', (err) => {
      reject(err)
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      reject(new Error(stderr.trim() || `stellar exited with code ${String(code)}`))
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createViaSoroban(params: {
  factoryContractId: string
  operatorAddress: string
  userAddress: string
  saltHex: string
  initialRootHex: string
}): Promise<string> {
  const sourceAccount = getDeployerSourceAccount()
  if (!sourceAccount) {
    throw new Error('Deployer source account is required for soroban mode (JSS_DEPLOYER_SOURCE_ACCOUNT).')
  }

  const args = [
    'contract',
    'invoke',
    '--id',
    params.factoryContractId,
    '--rpc-url',
    process.env.JSS_STELLAR_RPC_URL ?? DEFAULT_RPC_URL,
    '--network-passphrase',
    process.env.JSS_STELLAR_NETWORK_PASSPHRASE ??
      (DEFAULT_NETWORK === 'testnet'
        ? 'Test SDF Network ; September 2015'
        : 'Public Global Stellar Network ; September 2015'),
    '--source-account',
    sourceAccount,
    '--',
    'get_or_create_user_lockbox',
    '--caller',
    params.operatorAddress,
    '--user',
    params.userAddress,
    '--salt',
    params.saltHex,
    '--initial_root',
    params.initialRootHex,
  ]

  const output = await runStellarInvoke(args)
  const contractId = firstContractId(output)
  if (!contractId) {
    throw new Error('Could not parse lockbox contract ID from Soroban factory response.')
  }

  return contractId
}

async function createViaBridgeFactoryV3(params: {
  factoryContractId: string
  bridgeProof: BridgeProofPayload
}): Promise<string> {
  const sourceAccount = getDeployerSourceAccount()
  if (!sourceAccount) {
    throw new Error('Deployer source account is required for Lockb0x Bridge Factory v3.')
  }

  const args = [
    'contract',
    'invoke',
    '--id',
    params.factoryContractId,
    '--rpc-url',
    process.env.JSS_STELLAR_RPC_URL ?? DEFAULT_RPC_URL,
    '--network-passphrase',
    process.env.JSS_STELLAR_NETWORK_PASSPHRASE ??
      (DEFAULT_NETWORK === 'testnet'
        ? 'Test SDF Network ; September 2015'
        : 'Public Global Stellar Network ; September 2015'),
    '--source-account',
    sourceAccount,
    '--',
    'create_or_get_bridge_lockbox',
    '--account_commitment',
    normalizeHex(params.bridgeProof.accountCommitmentHex, 'accountCommitmentHex', 64),
    '--pod_binding',
    normalizeHex(params.bridgeProof.podBindingHex, 'podBindingHex', 64),
    '--claim_hash',
    normalizeHex(params.bridgeProof.claimHashHex, 'claimHashHex', 64),
    '--proof_bytes',
    normalizeHex(params.bridgeProof.proofHex, 'proofHex', 512),
    '--proof_hash',
    normalizeHex(params.bridgeProof.proofHashHex, 'proofHashHex', 64),
    '--ciphertext',
    normalizeBoundedHex(params.bridgeProof.ciphertextHex, 'ciphertextHex', 4096),
    '--circuit_version',
    String(params.bridgeProof.circuitVersion),
  ]

  const output = await runStellarInvoke(args)
  const contractId = firstContractId(output)
  if (!contractId) {
    throw new Error(`Could not parse Lockb0x Bridge Factory v3 response. Raw output: ${output}`)
  }
  return contractId
}

async function readLockboxWasmHash(factoryContractId: string): Promise<string> {
  const sourceAccount = getDeployerSourceAccount()
  if (!sourceAccount) {
    throw new Error('Deployer source account is required for soroban mode (JSS_DEPLOYER_SOURCE_ACCOUNT).')
  }

  const configuredWasmHash = process.env.JSS_LOCKBOX_WASM_HASH?.trim()
  if (configuredWasmHash && /^[a-fA-F0-9]{64}$/.test(configuredWasmHash)) {
    return configuredWasmHash.toLowerCase()
  }

  const referenceLockboxContractId = process.env.JSS_LOCKBOX_REFERENCE_CONTRACT_ID?.trim()
  if (referenceLockboxContractId) {
    const infoArgs = [
      'contract',
      'info',
      'hash',
      '--contract-id',
      referenceLockboxContractId,
      '--network',
      DEFAULT_NETWORK,
    ]

    const infoOutput = await runStellarInvoke(infoArgs)
    const infoHash = firstHex64(infoOutput)
    if (!infoHash) {
      throw new Error(
        `Could not parse lockbox wasm hash from reference lockbox contract. Raw output: ${infoOutput}`,
      )
    }

    return infoHash
  }

  const args = [
    'contract',
    'invoke',
    '--id',
    factoryContractId,
    '--rpc-url',
    process.env.JSS_STELLAR_RPC_URL ?? DEFAULT_RPC_URL,
    '--network-passphrase',
    process.env.JSS_STELLAR_NETWORK_PASSPHRASE ??
      (DEFAULT_NETWORK === 'testnet'
        ? 'Test SDF Network ; September 2015'
        : 'Public Global Stellar Network ; September 2015'),
    '--source-account',
    sourceAccount,
    '--',
    'get_lockbox_wasm_hash',
  ]

  const output = await runStellarInvoke(args)
  const wasmHash = firstHex64(output)
  if (!wasmHash) {
    throw new Error(`Could not parse lockbox wasm hash from factory response. Raw output: ${output}`)
  }

  return wasmHash
}

async function deployLockboxContract(wasmHash: string): Promise<string> {
  const sourceAccount = getDeployerSourceAccount()
  if (!sourceAccount) {
    throw new Error('Deployer source account is required for soroban mode (JSS_DEPLOYER_SOURCE_ACCOUNT).')
  }

  const args = [
    'contract',
    'deploy',
    '--wasm-hash',
    wasmHash,
    '--rpc-url',
    process.env.JSS_STELLAR_RPC_URL ?? DEFAULT_RPC_URL,
    '--network-passphrase',
    process.env.JSS_STELLAR_NETWORK_PASSPHRASE ??
      (DEFAULT_NETWORK === 'testnet'
        ? 'Test SDF Network ; September 2015'
        : 'Public Global Stellar Network ; September 2015'),
    '--source-account',
    sourceAccount,
  ]

  const maxAttempts = 4
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const output = await runStellarInvoke(args)
      const contractId = firstContractId(output)
      if (!contractId) {
        throw new Error('Could not parse deployed lockbox contract ID from Soroban deploy response.')
      }

      return contractId
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)
      const transientTimeout = message.toLowerCase().includes('request timeout')

      if (transientTimeout && attempt < maxAttempts) {
        await sleep(1200 * attempt)
        continue
      }

      throw err
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Lockbox deploy failed.')
}

async function initializeLockboxContract(params: {
  lockboxContractId: string
  operatorAddress: string
  initialRootHex: string
}): Promise<void> {
  const sourceAccount = getDeployerSourceAccount()
  if (!sourceAccount) {
    throw new Error('Deployer source account is required for soroban mode (JSS_DEPLOYER_SOURCE_ACCOUNT).')
  }

  const args = [
    'contract',
    'invoke',
    '--id',
    params.lockboxContractId,
    '--rpc-url',
    process.env.JSS_STELLAR_RPC_URL ?? DEFAULT_RPC_URL,
    '--network-passphrase',
    process.env.JSS_STELLAR_NETWORK_PASSPHRASE ??
      (DEFAULT_NETWORK === 'testnet'
        ? 'Test SDF Network ; September 2015'
        : 'Public Global Stellar Network ; September 2015'),
    '--source-account',
    sourceAccount,
    '--',
    'initialize',
    '--operator',
    params.operatorAddress,
    '--initial_root',
    params.initialRootHex,
  ]

  const maxAttempts = 8
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runStellarInvoke(args)
      return
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)
      const normalized = message.toLowerCase()
      const transientMissingValue = message.includes('Error(Storage, MissingValue)')
      const transientTimeout = normalized.includes('request timeout')
      // A freshly deployed contract can be briefly invisible to the RPC node
      // simulating the initialize call (ledger state propagation lag), surfacing
      // as "Contract not found". This is transient and resolves on retry.
      const transientContractNotFound = normalized.includes('contract not found')

      if (
        (transientMissingValue || transientTimeout || transientContractNotFound) &&
        attempt < maxAttempts
      ) {
        await sleep(1200 * attempt)
        continue
      }

      throw err
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Lockbox initialize failed.')
}

async function createDirectPerUserLockbox(params: {
  factoryContractId: string
  operatorAddress: string
  initialRootHex: string
}): Promise<string> {
  const wasmHash = await readLockboxWasmHash(params.factoryContractId)
  const lockboxContractId = await deployLockboxContract(wasmHash)
  // Give the RPC node a brief moment to propagate the newly deployed contract
  // before initializing it, reducing the transient "Contract not found" window.
  await sleep(2000)
  await initializeLockboxContract({
    lockboxContractId,
    operatorAddress: params.operatorAddress,
    initialRootHex: params.initialRootHex,
  })

  return lockboxContractId
}

export class LockboxFactoryProvisioner {
  private userLockboxes = new Map<string, string>()

  provision(input: {
    webId: string
    stellarPublicKey: string
    podBindingHash: string
    proofRootHex: string
  }): Promise<LockboxProvisioning> {
    return this.provisionInternal(input)
  }

  private async provisionInternal(input: {
    webId: string
    stellarPublicKey: string
    podBindingHash: string
    proofRootHex: string
    bridgeProof?: BridgeProofPayload
  }): Promise<LockboxProvisioning> {
    const verifiedAt = new Date().toISOString()
    const idempotencyKey = `${canonical(input.webId)}|${canonical(input.stellarPublicKey)}`
    const mode = parseFactoryMode(process.env.JSS_LOCKBOX_FACTORY_MODE ?? 'mock')
    const factoryContractId =
      process.env.JSS_LOCKBOX_FACTORY_CONTRACT_ID ?? process.env.NZ_LOCKBOX_FACTORY_CONTRACT_ID ?? ''

    if (mode !== 'soroban') {
      // Test/dev-only escape hatch, double-gated so no staging/production
      // profile can ever activate it: mock mode may return a deterministic
      // fake lockbox ONLY under NZ_ENV_PROFILE=local with the explicit
      // JSS_LOCKBOX_FACTORY_ALLOW_MOCK_READY flag (used by unit/e2e tests).
      const allowMockReady =
        mode === 'mock' &&
        (process.env.NZ_ENV_PROFILE ?? 'local') === 'local' &&
        /^(1|true)$/i.test((process.env.JSS_LOCKBOX_FACTORY_ALLOW_MOCK_READY ?? '').trim())
      if (allowMockReady) {
        const fakeContractId = `C${toBytes32Hex(idempotencyKey)
          .toUpperCase()
          .replace(/[^A-Z2-7]/g, 'A')
          .slice(0, 55)
          .padEnd(55, 'A')}`
        this.userLockboxes.set(idempotencyKey, fakeContractId)
        return {
          status: 'ready',
          mode,
          factoryContractId: factoryContractId.trim() || null,
          userLockboxContractId: fakeContractId,
          idempotencyKey,
          verifiedAt,
          proofRootHex: canonical(input.proofRootHex),
        }
      }
      return {
        status: 'error',
        mode,
        factoryContractId: factoryContractId.trim() || null,
        userLockboxContractId: null,
        idempotencyKey,
        verifiedAt,
        proofRootHex: canonical(input.proofRootHex),
        error: 'Per-user lockbox provisioning requires JSS_LOCKBOX_FACTORY_MODE=soroban.',
      }
    }

    if (!factoryContractId.trim()) {
      return {
        status: 'error',
        mode: 'soroban',
        factoryContractId: null,
        userLockboxContractId: null,
        idempotencyKey,
        verifiedAt,
        proofRootHex: canonical(input.proofRootHex),
        error: 'JSS_LOCKBOX_FACTORY_CONTRACT_ID is required for per-user lockbox provisioning.',
      }
    }

    const existing = this.userLockboxes.get(idempotencyKey)
    if (existing) {
      return {
        status: 'ready',
        mode: 'soroban',
        factoryContractId: factoryContractId.trim(),
        userLockboxContractId: existing,
        idempotencyKey,
        verifiedAt,
        proofRootHex: canonical(input.proofRootHex),
      }
    }

    try {
      const operatorAddress = process.env.JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS
      if (!operatorAddress || operatorAddress.trim().length === 0) {
        throw new Error('JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS is required for soroban mode.')
      }

      // Pre-flight top-up (fail-closed): ensure the Deployer holds >= 50 TestNet
      // XLM before spending gas on the per-user lockb0x deploy + initialize. If
      // the Treasury cannot restore the floor, do NOT attempt lockbox creation.
      await ensureDeployerFunded()

      let created: string
      if ((process.env.JSS_LOCKBOX_FACTORY_VERSION ?? 'v2').trim().toLowerCase() === 'v3') {
        if (!input.bridgeProof) {
          throw new Error('Lockb0x Bridge Factory v3 requires a complete bridge proof payload.')
        }
        created = await createViaBridgeFactoryV3({
          factoryContractId: factoryContractId.trim(),
          bridgeProof: input.bridgeProof,
        })
      } else {
        try {
          created = await createViaSoroban({
            factoryContractId: factoryContractId.trim(),
            operatorAddress: operatorAddress.trim(),
            userAddress: canonical(input.stellarPublicKey),
            saltHex: toBytes32Hex(`salt:${idempotencyKey}`),
            initialRootHex: canonical(input.proofRootHex),
          })
        } catch {
          // Legacy v2 behavior remains available only until the fresh Factory
          // v3 TestNet deployment is configured. V3 itself never falls back.
          created = await createDirectPerUserLockbox({
            factoryContractId: factoryContractId.trim(),
            operatorAddress: operatorAddress.trim(),
            initialRootHex: canonical(input.proofRootHex),
          })
        }
      }

      this.userLockboxes.set(idempotencyKey, created)
      return {
        status: 'ready',
        mode: 'soroban',
        factoryContractId: factoryContractId.trim(),
        userLockboxContractId: created,
        idempotencyKey,
        verifiedAt,
        proofRootHex: canonical(input.proofRootHex),
      }
    } catch (err) {
      return {
        status: 'error',
        mode: 'soroban',
        factoryContractId: factoryContractId.trim(),
        userLockboxContractId: null,
        idempotencyKey,
        verifiedAt,
        proofRootHex: canonical(input.proofRootHex),
        error: err instanceof Error ? err.message : 'Soroban lockbox provisioning failed.',
      }
    }
  }
}