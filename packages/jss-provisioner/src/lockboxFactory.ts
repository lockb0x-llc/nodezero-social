import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { LockboxProvisioning } from './types.js'

type FactoryMode = 'mock' | 'disabled' | 'soroban'

const DEFAULT_RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const DEFAULT_NETWORK = process.env.STELLAR_NETWORK ?? 'testnet'

function canonical(input: string): string {
  return input.trim()
}

function toBytes32Hex(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex')
}

function deriveMockLockboxContractId(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey, 'utf8').digest('hex').slice(0, 32)
  return `mock-lockbox-${digest}`
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

function isMissingFactoryMethod(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const message = err.message
  return (
    message.includes("unrecognized subcommand 'get_or_create_user_lockbox'") ||
    (message.includes('get_or_create_user_lockbox') &&
      (message.includes('InvalidAction') || message.includes('UnreachableCodeReached')))
  )
}

async function createViaSoroban(params: {
  factoryContractId: string
  operatorAddress: string
  userAddress: string
  saltHex: string
  initialRootHex: string
}): Promise<string> {
  const sourceAccount = process.env.JSS_STELLAR_SOURCE_ACCOUNT
  if (!sourceAccount || sourceAccount.trim().length === 0) {
    throw new Error('JSS_STELLAR_SOURCE_ACCOUNT is required for soroban mode.')
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

async function verifySharedLockbox(params: { contractId: string }): Promise<string> {
  const sourceAccount = process.env.JSS_STELLAR_SOURCE_ACCOUNT
  if (!sourceAccount || sourceAccount.trim().length === 0) {
    throw new Error('JSS_STELLAR_SOURCE_ACCOUNT is required for soroban mode.')
  }

  await runStellarInvoke([
    'contract',
    'invoke',
    '--id',
    params.contractId,
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
    'get_state_root',
  ])

  return params.contractId
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
  }): Promise<LockboxProvisioning> {
    const verifiedAt = new Date().toISOString()
    const idempotencyKey = `${canonical(input.webId)}|${canonical(input.stellarPublicKey)}`
    const mode = parseFactoryMode(process.env.JSS_LOCKBOX_FACTORY_MODE ?? 'mock')
    const factoryContractId =
      process.env.JSS_LOCKBOX_FACTORY_CONTRACT_ID ?? process.env.NZ_LOCKBOX_FACTORY_CONTRACT_ID ?? ''

    if (mode === 'disabled' || !factoryContractId.trim()) {
      return {
        status: 'skipped',
        mode: 'disabled',
        factoryContractId: factoryContractId.trim() || null,
        userLockboxContractId: null,
        idempotencyKey,
        verifiedAt,
          proofRootHex: canonical(input.proofRootHex),
      }
    }

    const existing = this.userLockboxes.get(idempotencyKey)
    if (existing) {
      return {
        status: 'ready',
        mode: mode === 'soroban' ? 'soroban' : 'mock',
        factoryContractId: factoryContractId.trim(),
        userLockboxContractId: existing,
        idempotencyKey,
        verifiedAt,
        proofRootHex: canonical(input.proofRootHex),
      }
    }

    if (mode === 'soroban') {
      try {
        const operatorAddress = process.env.JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS
        if (!operatorAddress || operatorAddress.trim().length === 0) {
          throw new Error('JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS is required for soroban mode.')
        }

        const created = await createViaSoroban({
          factoryContractId: factoryContractId.trim(),
          operatorAddress: operatorAddress.trim(),
          userAddress: canonical(input.stellarPublicKey),
          saltHex: toBytes32Hex(`salt:${idempotencyKey}`),
          initialRootHex: canonical(input.proofRootHex),
        }).catch((err: unknown) => {
          if (isMissingFactoryMethod(err)) {
            return verifySharedLockbox({ contractId: factoryContractId.trim() })
          }
          throw err
        })

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

    const created = deriveMockLockboxContractId(idempotencyKey)
    this.userLockboxes.set(idempotencyKey, created)
    return {
      status: 'ready',
      mode: 'mock',
      factoryContractId: factoryContractId.trim(),
      userLockboxContractId: created,
      idempotencyKey,
      verifiedAt,
      proofRootHex: canonical(input.proofRootHex),
    }
  }
}