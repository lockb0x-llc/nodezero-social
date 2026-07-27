/**
 * @module WalletService
 *
 * High-level Stellar wallet operations for NodeZero.
 *
 * Responsibilities:
 * 1. Derive the Stellar keypair from the enclave-stored secret.
 * 2. Submit signed Soroban contract invocations to the Stellar network.
 * 3. Handle fee sponsoring so users never see a gas prompt.
 *
 * The default network is Stellar **Testnet** during development.
 * Switch to `Networks.PUBLIC` and `ServerEndpoint.MAINNET` for production.
 */

import {
  Account,
  Keypair,
  Networks,
  TransactionBuilder,
  Contract,
  nativeToScVal,
  scValToNative,
  Address,
  BASE_FEE,
  rpc,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import type { EnclaveAdapter } from './EnclaveAdapter.js'
import type {
  WalletInfo,
  WalletIdentity,
  TransactionResult,
  IdentityHashPayload,
  AttestationSignature,
} from './types.js'

/** Horizon / Soroban RPC endpoint constants. */
export const ServerEndpoint = {
  TESTNET: 'https://soroban-testnet.stellar.org',
  MAINNET: 'https://soroban.stellar.org',
} as const

const HorizonEndpoint = {
  TESTNET: 'https://horizon-testnet.stellar.org',
  MAINNET: 'https://horizon.stellar.org',
} as const

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function bytesLikeToHex(value: unknown): string | null {
  if (typeof value === 'string') return value

  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  if (value instanceof Uint8Array) {
    return Array.from(value)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return value.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  if (value && typeof value === 'object') {
    const bytesObject = value as {
      data?: unknown
      value?: unknown
      _value?: unknown
      toString?: (encoding?: string) => string
    }

    try {
      const encoded = bytesObject.toString?.('hex')
      if (encoded && /^[0-9a-f]+$/i.test(encoded)) return encoded
    } catch {
      // Fall through to known object shapes below.
    }

    return (
      bytesLikeToHex(bytesObject.data) ??
      bytesLikeToHex(bytesObject.value) ??
      bytesLikeToHex(bytesObject._value)
    )
  }

  return null
}

function isScVal(value: unknown): value is xdr.ScVal {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { switch?: unknown }).switch === 'function' &&
    typeof (value as { value?: unknown }).value === 'function'
  )
}

function toContractAddress(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return /^C[A-Z0-9]{55}$/.test(trimmed) ? trimmed : null
  }

  if (Array.isArray(value) && value.length > 0) {
    return toContractAddress(value[0])
  }

  if (value && typeof value === 'object') {
    const maybeAddress = value as { toString?: () => string }
    try {
      const rendered = maybeAddress.toString?.()
      if (rendered && /^C[A-Z0-9]{55}$/.test(rendered.trim())) {
        return rendered.trim()
      }
    } catch {
      // Ignore and fall through.
    }
  }

  return null
}

/**
 * Provides Stellar wallet operations backed by an {@link EnclaveAdapter}.
 *
 * @example
 * ```ts
 * const wallet = new WalletService(enclaveAdapter)
 * const info = await wallet.getWalletInfo()
 * console.log(info.publicKey) // "GAXXX…"
 *
 * await wallet.registerIdentityOnChain({
 *   webId: 'https://alice.solidcommunity.net/profile/card#me',
 *   stellarPublicKey: info.publicKey,
 * }, 'CXXX_CONTRACT_ID')
 * ```
 */
export class WalletService {
  private readonly adapter: EnclaveAdapter
  private readonly server: rpc.Server
  private readonly network: string
  private readonly horizonUrl: string
  private readonly fundedAccounts = new Set<string>()

  /**
   * @param adapter - An initialised {@link EnclaveAdapter}.
   * @param rpcUrl - Soroban RPC endpoint URL. Defaults to testnet.
   * @param network - Stellar network passphrase. Defaults to testnet.
   */
  constructor(
    adapter: EnclaveAdapter,
    rpcUrl: string = ServerEndpoint.TESTNET,
    network: string = Networks.TESTNET
  ) {
    this.adapter = adapter
    this.server = new rpc.Server(rpcUrl)
    this.network = network
    this.horizonUrl =
      network === Networks.PUBLIC ? HorizonEndpoint.MAINNET : HorizonEndpoint.TESTNET
  }

  async listIdentities(): Promise<WalletIdentity[]> {
    const identities = await this.adapter.listIdentities()
    return identities.map((identity) => ({
      keyId: identity.keyId,
      label: identity.label,
      createdAt: identity.createdAt,
      lastUsedAt: identity.lastUsedAt,
    }))
  }

  async createIdentity(label?: string): Promise<WalletInfo> {
    const identity = await this.adapter.createIdentity(label)
    const secret = await this.adapter.loadOrCreate(identity.keyId)
    const keypair = Keypair.fromSecret(secret)
    const publicKey = keypair.publicKey()
    const isFunded = await this.ensureAccountExists(publicKey)
    return {
      keyId: identity.keyId,
      publicKey,
      isFunded,
    }
  }

  async renameIdentity(keyId: string, label: string): Promise<void> {
    await this.adapter.renameIdentity(keyId, label)
  }

  async deleteIdentity(keyId: string): Promise<void> {
    await this.adapter.deleteIdentity(keyId)
  }

  async setActiveIdentity(keyId: string): Promise<void> {
    await this.adapter.setActiveIdentityKeyId(keyId)
  }

  async getActiveIdentityKeyId(): Promise<string | null> {
    return this.adapter.getActiveIdentityKeyId()
  }

  /**
   * Returns basic information about the local wallet.
   * Loads (or creates) the keypair from the enclave.
   */
  async getWalletInfo(): Promise<WalletInfo> {
    const keyId = await this.adapter.getActiveIdentityKeyId()
    const secret = await this.adapter.loadOrCreate(keyId ?? undefined)
    const keypair = Keypair.fromSecret(secret)
    const publicKey = keypair.publicKey()

    const isFunded = await this.ensureAccountExists(publicKey)

    const resolvedKeyId = await this.adapter.getActiveIdentityKeyId()
    if (!resolvedKeyId) {
      throw new Error('Embedded wallet identity is not available.')
    }

    return { keyId: resolvedKeyId, publicKey, isFunded }
  }

  async getWalletInfoForIdentity(keyId: string): Promise<WalletInfo> {
    const secret = await this.adapter.loadOrCreate(keyId)
    const keypair = Keypair.fromSecret(secret)
    const publicKey = keypair.publicKey()
    const isFunded = await this.ensureAccountExists(publicKey)
    return { keyId, publicKey, isFunded }
  }

  /**
   * Returns the local Stellar public key without performing any network I/O.
   * Useful for UI readiness paths that must not block on RPC/Friendbot latency.
   */
  async getWalletPublicKey(): Promise<string> {
    const active = await this.adapter.getActiveIdentityKeyId()
    const secret = await this.adapter.loadOrCreate(active ?? undefined)
    return Keypair.fromSecret(secret).publicKey()
  }

  async getWalletPublicKeyForIdentity(keyId: string): Promise<string> {
    const secret = await this.adapter.loadOrCreate(keyId)
    return Keypair.fromSecret(secret).publicKey()
  }

  /**
   * Signs a canonical custody-attestation challenge payload with the embedded
   * Stellar keypair and returns the base64-encoded signature.
   */
  async signAttestationChallenge(challengePayload: string): Promise<AttestationSignature> {
    const trimmedPayload = challengePayload.trim()
    if (!trimmedPayload) {
      throw new Error('Attestation challenge payload is required.')
    }

    const active = await this.adapter.getActiveIdentityKeyId()
    const secret = await this.adapter.loadOrCreate(active ?? undefined)
    const keypair = Keypair.fromSecret(secret)
    const payloadBytes = new TextEncoder().encode(trimmedPayload)
    const signatureBytes = keypair.sign(payloadBytes as any)

    return {
      stellarPublicKey: keypair.publicKey(),
      challengePayload: trimmedPayload,
      signatureBase64: Buffer.from(signatureBytes).toString('base64'),
    }
  }

  /**
   * Returns the stored secret key for export, or `null` if none provisioned.
   * Callers must treat the returned value as highly sensitive.
   */
  async exportSecret(): Promise<string | null> {
    return this.adapter.load()
  }

  async exportSecretForIdentity(keyId: string): Promise<string | null> {
    return this.adapter.load(keyId)
  }

  /**
   * Permanently destroys the embedded wallet secret. Irreversible: a fresh
   * keypair is provisioned on next wallet access.
   */
  async destroyWallet(): Promise<void> {
    await this.adapter.destroy()
  }

  async destroyWalletIdentity(keyId: string): Promise<void> {
    await this.adapter.destroy(keyId)
  }

  /**
   * Submits an invocation of the `NodeZeroIdentity.register_webid()` Soroban
   * contract function to record the user's Solid WebID on-chain.
   *
   * Fee sponsoring is applied: the transaction base fee is set to the current
   * Stellar network minimum and submitted via the Soroban RPC `sendTransaction`
   * endpoint.
   *
   * @param payload - The identity payload containing the WebID and public key.
   * @param contractId - The deployed `NodeZeroIdentity` contract ID (C… address).
   * @returns {@link TransactionResult}
   */
  async registerIdentityOnChain(
    payload: IdentityHashPayload,
    contractId: string
  ): Promise<TransactionResult> {
    const active = await this.adapter.getActiveIdentityKeyId()
    const secret = await this.adapter.loadOrCreate(active ?? undefined)
    const keypair = Keypair.fromSecret(secret)
    const publicKey = keypair.publicKey()

    const account = await this.getSourceAccount(publicKey)
    const contract = new Contract(contractId)

    const callerScVal = new Address(publicKey).toScVal()
    const webIdScVal = nativeToScVal(payload.webId, { type: 'string' })

    const tx: Transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.network,
    })
      .addOperation(contract.call('register_webid', callerScVal, webIdScVal))
      .setTimeout(30)
      .build()

    // Prepare (simulate) the transaction to get the resource footprint.
    const prepared = await this.server.prepareTransaction(tx)
    prepared.sign(keypair)

    const result = await this.server.sendTransaction(prepared)

    if (result.status === 'ERROR') {
      throw new Error(
        `Transaction failed: ${result.errorResult?.toXDR('base64') ?? 'unknown error'}`
      )
    }

    if (result.status === 'TRY_AGAIN_LATER') {
      throw new Error('Transaction submission was throttled. Retry WebID registration shortly.')
    }

    const finalResult = await this.server.pollTransaction(result.hash, { attempts: 20 })
    if (String(finalResult.status) !== 'SUCCESS') {
      throw new Error(`Transaction did not complete successfully: ${finalResult.status}`)
    }

    return {
      hash: result.hash,
      success: true,
    }
  }

  /**
   * Submits an invocation of `NodeZeroIdentity.remove_webid()` to unlink the
   * caller's Solid WebID from their Stellar public key on-chain. Used by the
   * Settings "Delete Node Data" flow before the local enclave key is destroyed.
   *
   * @param contractId - The deployed `NodeZeroIdentity` contract ID (C… address).
   * @returns {@link TransactionResult}
   */
  async removeIdentityOnChain(contractId: string): Promise<TransactionResult> {
    const active = await this.adapter.getActiveIdentityKeyId()
    const secret = await this.adapter.loadOrCreate(active ?? undefined)
    const keypair = Keypair.fromSecret(secret)
    const publicKey = keypair.publicKey()

    const account = await this.getSourceAccount(publicKey)
    const contract = new Contract(contractId)
    const callerScVal = new Address(publicKey).toScVal()

    const tx: Transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.network,
    })
      .addOperation(contract.call('remove_webid', callerScVal))
      .setTimeout(30)
      .build()

    const prepared = await this.server.prepareTransaction(tx)
    prepared.sign(keypair)

    const result = await this.server.sendTransaction(prepared)

    if (result.status === 'ERROR') {
      throw new Error(
        `Transaction failed: ${result.errorResult?.toXDR('base64') ?? 'unknown error'}`
      )
    }

    if (result.status === 'TRY_AGAIN_LATER') {
      throw new Error('Transaction submission was throttled. Retry WebID removal shortly.')
    }

    const finalResult = await this.server.pollTransaction(result.hash, { attempts: 20 })
    if (String(finalResult.status) !== 'SUCCESS') {
      throw new Error(`Transaction did not complete successfully: ${finalResult.status}`)
    }

    return {
      hash: result.hash,
      success: true,
    }
  }

  /**
   * Reads `NodeZeroIdentity.get_webid(caller)` for the current wallet address.
   * Returns the registered WebID string or `null` when unset/unreadable.
   */
  async getRegisteredWebId(contractId: string): Promise<string | null> {
    const publicKey = await this.getWalletPublicKey()
    const value = await this.simulateContractCall(contractId, 'get_webid', [
      new Address(publicKey).toScVal(),
    ])

    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      const first = (value as unknown[])[0]
      if (typeof first === 'string') return first
    }
    return null
  }

  /**
   * Reads `Lockb0x.get_state_root()` and returns a hex-encoded root or `null`.
   */
  async getLockboxStateRoot(contractId: string): Promise<string | null> {
    const value = await this.simulateContractCall(contractId, 'get_state_root', [])

    if (value == null) return null
    if (Array.isArray(value) && value.length > 0) {
      const inner = (value as unknown[])[0]
      return bytesLikeToHex(inner)
    }
    return bytesLikeToHex(value)
  }

  /**
   * Reads `Lockb0x.get_account_commitment()` and returns the 32-byte identity
   * anchor as hex, or `null` when unset. Used to verify a returning login
   * against the on-chain ZK identity commitment.
   */
  async getLockboxAccountCommitment(contractId: string): Promise<string | null> {
    const value = await this.simulateContractCall(contractId, 'get_account_commitment', [])

    if (value == null) return null
    if (Array.isArray(value) && value.length > 0) {
      const inner = (value as unknown[])[0]
      return bytesLikeToHex(inner)
    }
    return bytesLikeToHex(value)
  }

  /**
   * Reads `Lockb0xFactory.get_user_lockbox(user)` and returns the mapped lockbox
   * contract ID, or `null` when no mapping exists.
   */
  async getFactoryUserLockbox(
    factoryContractId: string,
    userPublicKey: string
  ): Promise<string | null> {
    const value = await this.simulateContractCall(factoryContractId, 'get_user_lockbox', [
      new Address(userPublicKey).toScVal(),
    ])

    if (value == null) return null
    return toContractAddress(value)
  }

  private async simulateContractCall(
    contractId: string,
    method: string,
    args: xdr.ScVal[]
  ): Promise<unknown> {
    // A read-only simulation does not submit or sign a transaction. Requiring
    // Horizon to index a newly Treasury-funded device here creates a false
    // attestation failure during the Testnet propagation window. Soroban
    // accepts a sequence-zero synthetic source for these no-auth getters.
    // State-changing operations continue to use getSourceAccount(), which
    // enforces a funded, Horizon-indexed account before signing/submission.
    const account = new Account(await this.getWalletPublicKey(), '0')

    const contract = new Contract(contractId)
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.network,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build()

    const simulation = await this.server.simulateTransaction(tx)
    const simulationAny = simulation as unknown as {
      error?: string
      result?: { retval?: string | xdr.ScVal }
      retval?: string | xdr.ScVal
    }

    if (simulationAny.error) {
      throw new Error(`Simulation failed for ${method}: ${simulationAny.error}`)
    }

    const retval = simulationAny.result?.retval ?? simulationAny.retval
    if (!retval) return null

    const scVal = isScVal(retval) ? retval : xdr.ScVal.fromXDR(retval, 'base64')
    try {
      const decoded: unknown = scValToNative(scVal)
      return decoded
    } catch {
      return scVal.value()
    }
  }

  private async getSourceAccount(publicKey: string): Promise<Account> {
    const isFunded = await this.ensureAccountExists(publicKey)
    if (!isFunded && !this.fundedAccounts.has(publicKey)) {
      throw new Error(
        'Stellar account is not funded. Fund the embedded wallet before contract operations.'
      )
    }

    return this.getAccountWithRetry(publicKey)
  }

  private async getAccountWithRetry(publicKey: string): Promise<Account> {
    let lastError: unknown
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const account = await this.getHorizonAccount(publicKey)
        this.fundedAccounts.add(publicKey)
        return account
      } catch (err) {
        lastError = err
        await delay(1_500)
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Unable to load Stellar source account.')
  }

  private async getHorizonAccount(publicKey: string): Promise<Account> {
    const response = await fetch(`${this.horizonUrl}/accounts/${encodeURIComponent(publicKey)}`)
    if (!response.ok) {
      throw new Error(`Horizon account lookup failed (${response.status}).`)
    }
    const body = (await response.json()) as { sequence?: unknown }
    if (typeof body.sequence !== 'string' || !/^\d+$/.test(body.sequence)) {
      throw new Error('Horizon account response did not include a sequence number.')
    }
    return new Account(publicKey, body.sequence)
  }

  private async ensureAccountExists(publicKey: string): Promise<boolean> {
    try {
      await this.getHorizonAccount(publicKey)
      this.fundedAccounts.add(publicKey)
      return true
    } catch {
      // Wallets are funded only by the provisioner during node creation. The
      // browser must never call Friendbot or hold a Treasury funding capability.
      return false
    }
  }
}
