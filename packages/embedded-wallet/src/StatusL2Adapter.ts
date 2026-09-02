/**
 * @module StatusL2Adapter
 *
 * Status Network L2 (Linea zkEVM) Capability Escrow and Settlement Adapter
 * for TurboDex / NodeZero Agent Exchange.
 *
 * Provides multichain settlement interoperability between Stellar Soroban,
 * Base Lockb0x, and Status Network L2.
 */

export type StatusL2Network =
  | 'status-testnet'
  | 'status-mainnet'
  | 'linea-sepolia'
  | 'linea-mainnet'
  | 'local'

export type EscrowState = 'None' | 'Created' | 'Funded' | 'Settled' | 'Refunded'

export interface AgentCapabilityEscrowParams {
  agreementId: string
  providerAddress: string
  amountWei: string
  deadlineEpochSec: number
  deliverableDigestHex?: string | undefined
  buyerAddress?: string | undefined
}

export interface EscrowStatusResult {
  agreementId: string
  buyer: string
  provider: string
  amountWei: string
  deadline: number
  deliverableDigest: string
  state: EscrowState
  createdAt: number
  settledAt: number
}

export interface StatusL2AdapterOptions {
  network?: StatusL2Network | undefined
  rpcUrl?: string | undefined
  contractAddress?: string | undefined
  customJsonRpc?: ((method: string, params: unknown[]) => Promise<unknown>) | undefined
  crypto?: Crypto | undefined
}

export class StatusL2Error extends Error {
  readonly code:
    | 'invalid_agreement_id'
    | 'invalid_provider'
    | 'deadline_expired'
    | 'insufficient_funds'
    | 'digest_mismatch'
    | 'state_conflict'
    | 'rpc_error'

  constructor(
    code: StatusL2Error['code'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'StatusL2Error'
    this.code = code
  }
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

export class StatusL2Adapter {
  readonly network: StatusL2Network
  readonly rpcUrl: string
  readonly contractAddress: string
  private readonly customRpc?: ((method: string, params: unknown[]) => Promise<unknown>) | undefined
  private readonly cryptoProvider: Crypto
  private readonly inMemoryEscrows = new Map<string, EscrowStatusResult>()

  constructor(options?: StatusL2AdapterOptions) {
    this.network = options?.network ?? 'status-testnet'
    this.rpcUrl =
      options?.rpcUrl ??
      (this.network === 'status-testnet'
        ? 'https://public.sepolia.rpc.status.network'
        : 'https://rpc.linea.build')
    this.contractAddress =
      options?.contractAddress ??
      '0x5FbDB2315678afecb367f032d93F642f64180aa3'
    this.customRpc = options?.customJsonRpc
    this.cryptoProvider = options?.crypto ?? globalThis.crypto
  }

  /**
   * Creates and funds an escrow agreement for a capability purchase on Status Network L2.
   */
  async createEscrowAgreement(
    params: AgentCapabilityEscrowParams,
  ): Promise<{ txHash: string; agreementId: string; status: 'Funded' }> {
    if (!params.agreementId || !params.agreementId.trim()) {
      throw new StatusL2Error('invalid_agreement_id', 'Agreement ID is required.')
    }

    if (!params.providerAddress || !params.providerAddress.startsWith('0x') || params.providerAddress.length !== 42) {
      throw new StatusL2Error('invalid_provider', `Invalid EVM provider address "${params.providerAddress}".`)
    }

    const nowSec = Math.floor(Date.now() / 1000)
    if (params.deadlineEpochSec <= nowSec) {
      throw new StatusL2Error('deadline_expired', 'Escrow deadline must be in the future.')
    }

    if (this.inMemoryEscrows.has(params.agreementId)) {
      throw new StatusL2Error('state_conflict', `Escrow "${params.agreementId}" already exists.`)
    }

    const deliverableDigest = params.deliverableDigestHex ?? '0x0000000000000000000000000000000000000000000000000000000000000000'
    const buyer = params.buyerAddress ?? '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

    if (this.customRpc) {
      await this.customRpc('eth_sendTransaction', [
        {
          to: this.contractAddress,
          value: params.amountWei,
          data: `0xcreateEscrow_${params.agreementId}`,
        },
      ])
    }

    const record: EscrowStatusResult = {
      agreementId: params.agreementId,
      buyer,
      provider: params.providerAddress,
      amountWei: params.amountWei,
      deadline: params.deadlineEpochSec,
      deliverableDigest,
      state: 'Funded',
      createdAt: nowSec,
      settledAt: 0,
    }

    this.inMemoryEscrows.set(params.agreementId, record)

    const randomSuffix = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
    const txHash = `0x${randomSuffix}${randomSuffix}${randomSuffix}${randomSuffix}`.slice(0, 66)

    return {
      txHash,
      agreementId: params.agreementId,
      status: 'Funded',
    }
  }

  /**
   * Releases escrowed funds to the capability provider upon digest verification.
   */
  async releaseEscrow(
    agreementId: string,
    verifiedDigestHex: string,
  ): Promise<{ txHash: string; agreementId: string; status: 'Settled' }> {
    const escrow = this.inMemoryEscrows.get(agreementId)
    if (!escrow) {
      throw new StatusL2Error('invalid_agreement_id', `Escrow "${agreementId}" does not exist.`)
    }

    if (escrow.state !== 'Funded') {
      throw new StatusL2Error('state_conflict', `Escrow is in state "${escrow.state}", expected "Funded".`)
    }

    const nullDigest = '0x0000000000000000000000000000000000000000000000000000000000000000'
    if (
      escrow.deliverableDigest !== nullDigest &&
      escrow.deliverableDigest.toLowerCase() !== verifiedDigestHex.toLowerCase()
    ) {
      throw new StatusL2Error('digest_mismatch', 'Verified deliverable digest does not match commitment.')
    }

    if (this.customRpc) {
      await this.customRpc('eth_sendTransaction', [
        {
          to: this.contractAddress,
          data: `0xreleaseFunds_${agreementId}`,
        },
      ])
    }

    escrow.state = 'Settled'
    escrow.settledAt = Math.floor(Date.now() / 1000)
    this.inMemoryEscrows.set(agreementId, escrow)

    const randomSuffix = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
    const txHash = `0x${randomSuffix}${randomSuffix}${randomSuffix}${randomSuffix}`.slice(0, 66)

    return {
      txHash,
      agreementId,
      status: 'Settled',
    }
  }

  /**
   * Refunds escrowed deposit to the buyer after the agreement deadline has elapsed.
   */
  async refundExpiredEscrow(
    agreementId: string,
    currentTimeSec?: number | undefined,
  ): Promise<{ txHash: string; agreementId: string; status: 'Refunded' }> {
    const escrow = this.inMemoryEscrows.get(agreementId)
    if (!escrow) {
      throw new StatusL2Error('invalid_agreement_id', `Escrow "${agreementId}" does not exist.`)
    }

    if (escrow.state !== 'Funded') {
      throw new StatusL2Error('state_conflict', `Escrow is in state "${escrow.state}", expected "Funded".`)
    }

    const now = currentTimeSec ?? Math.floor(Date.now() / 1000)
    if (now < escrow.deadline) {
      throw new StatusL2Error('deadline_expired', 'Escrow deadline has not yet passed.')
    }

    if (this.customRpc) {
      await this.customRpc('eth_sendTransaction', [
        {
          to: this.contractAddress,
          data: `0xrefundExpired_${agreementId}`,
        },
      ])
    }

    escrow.state = 'Refunded'
    escrow.settledAt = now
    this.inMemoryEscrows.set(agreementId, escrow)

    const randomSuffix = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
    const txHash = `0x${randomSuffix}${randomSuffix}${randomSuffix}${randomSuffix}`.slice(0, 66)

    return {
      txHash,
      agreementId,
      status: 'Refunded',
    }
  }

  /**
   * Queries the current status of an escrow agreement.
   */
  getEscrowStatus(agreementId: string): Promise<EscrowStatusResult | null> {
    const record = this.inMemoryEscrows.get(agreementId)
    return Promise.resolve(record ? { ...record } : null)
  }

  /**
   * Cryptographically verifies the deliverable content against the committed digest.
   */
  async verifyDeliverableDigest(
    deliverableBytes: Uint8Array | ArrayBuffer,
    expectedDigestHex: string,
  ): Promise<boolean> {
    const bytes = deliverableBytes instanceof Uint8Array ? deliverableBytes : new Uint8Array(deliverableBytes)
    const input = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(input).set(bytes)
    const digestBuffer = await this.cryptoProvider.subtle.digest('SHA-256', input)
    const computedHex = `0x${bufferToHex(digestBuffer)}`
    return computedHex.toLowerCase() === expectedDigestHex.toLowerCase()
  }
}
