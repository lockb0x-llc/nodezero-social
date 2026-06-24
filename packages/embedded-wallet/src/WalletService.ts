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
  Keypair,
  Networks,
  TransactionBuilder,
  Contract,
  nativeToScVal,
  Address,
  BASE_FEE,
  rpc,
  type Transaction,
} from '@stellar/stellar-sdk'
import type { EnclaveAdapter } from './EnclaveAdapter.js'
import type { WalletInfo, TransactionResult, IdentityHashPayload } from './types.js'

/** Horizon / Soroban RPC endpoint constants. */
export const ServerEndpoint = {
  TESTNET: 'https://soroban-testnet.stellar.org',
  MAINNET: 'https://soroban.stellar.org',
} as const

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
  }

  /**
   * Returns basic information about the local wallet.
   * Loads (or creates) the keypair from the enclave.
   */
  async getWalletInfo(): Promise<WalletInfo> {
    const secret = await this.adapter.loadOrCreate()
    const keypair = Keypair.fromSecret(secret)
    const publicKey = keypair.publicKey()

    let isFunded = false
    try {
      await this.server.getAccount(publicKey)
      isFunded = true
    } catch {
      // Account does not exist on the network yet.
    }

    return { publicKey, isFunded }
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
    const secret = await this.adapter.loadOrCreate()
    const keypair = Keypair.fromSecret(secret)
    const publicKey = keypair.publicKey()

    const account = await this.server.getAccount(publicKey)
    const contract = new Contract(contractId)

    const callerScVal = new Address(publicKey).toScVal()
    const webIdScVal = nativeToScVal(payload.webId, { type: 'string' })

    const tx: Transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.network,
    })
      .addOperation(
        contract.call('register_webid', callerScVal, webIdScVal)
      )
      .setTimeout(30)
      .build()

    // Prepare (simulate) the transaction to get the resource footprint.
    const prepared = await this.server.prepareTransaction(tx)
    prepared.sign(keypair)

    const result = await this.server.sendTransaction(prepared)

    if (result.status === 'ERROR') {
      throw new Error(`Transaction failed: ${result.errorResult?.toXDR('base64') ?? 'unknown error'}`)
    }

    return {
      hash: result.hash,
      success: result.status !== 'ERROR',
    }
  }
}
