import { createHash, randomBytes } from 'node:crypto'
import {
  ConditionalWriteError,
  CredentialStore,
} from './credentialStore.js'

export const PROVISIONING_STATES = [
  'reserved',
  'proof_verified',
  'css_account_pending',
  'css_account_created',
  'css_login_created',
  'pod_created',
  'client_credentials_created',
  'lockbox_ready',
  'credential_committed',
  'session_verified',
  'completed',
  'failed_retryable',
  'failed_terminal',
  'manual_review',
] as const

export type ProvisioningState = (typeof PROVISIONING_STATES)[number]

export interface ProvisioningReservationInput {
  idempotencyKey: string
  requestDigest: string
  normalizedHandle: string
  normalizedEmail: string
  expectedWebId: string
  expectedPodUrl: string
  stellarPublicKey: string
  configFingerprint: string
  descriptorSnapshot: unknown
  resumeMaterial: unknown
  reservationTtlMs?: number
}

export interface ProvisioningOperation {
  schemaVersion: 1
  operationId: string
  idempotencyKeyHash: string
  requestDigest: string
  state: ProvisioningState
  normalizedHandle: string
  emailHash: string
  expectedWebId: string
  expectedPodUrl: string
  stellarPublicKey: string
  configFingerprint: string
  descriptorSnapshotJson: string
  encryptedResumeMaterialB64: string
  stepTimestampsJson: string
  attemptCount: number
  lastErrorCode: string | null
  manualReviewReason: string | null
  leaseOwner: string | null
  leaseTokenHash: string | null
  leaseEpoch: number
  leaseExpiresAt: string | null
  reservationExpiresAt: string
  createdAt: string
  updatedAt: string
}

export interface VersionedProvisioningOperation {
  operation: ProvisioningOperation
  etag: string
}

interface ProvisioningReservation {
  operationId: string
  requestDigest: string
  disposition: 'active' | 'committed'
  expiresAt: string | null
}

type ReservationRegistryRow = Record<string, unknown>

export interface ProvisioningLease {
  operationId: string
  owner: string
  token: string
  epoch: number
  expiresAt: string
}

export class ProvisioningConflictError extends Error {
  readonly code:
    | 'idempotency_payload_conflict'
    | 'reservation_conflict'
    | 'provisioning_in_progress'
    | 'lease_lost'
    | 'illegal_transition'

  constructor(code: ProvisioningConflictError['code'], message: string) {
    super(message)
    this.name = 'ProvisioningConflictError'
    this.code = code
  }
}

const OPERATION_ROW_PREFIX = 'provisioning-operation-'
const REGISTRY_ROW_KEY = 'provisioning-reservations-v1'
const RESERVATION_CHUNK_PREFIX = 'reservationsJson'
export const RESERVATION_CHUNK_MAX_CHARS = 24_000
const DEFAULT_RESERVATION_TTL_MS = 30 * 60_000
const LEGAL_TRANSITIONS: Record<ProvisioningState, readonly ProvisioningState[]> = {
  reserved: ['proof_verified', 'failed_terminal'],
  proof_verified: ['css_account_pending', 'failed_terminal'],
  css_account_pending: ['css_account_created', 'manual_review'],
  css_account_created: ['css_login_created', 'manual_review'],
  css_login_created: ['pod_created', 'manual_review'],
  pod_created: ['client_credentials_created', 'manual_review'],
  client_credentials_created: ['lockbox_ready', 'failed_retryable', 'manual_review'],
  lockbox_ready: ['credential_committed', 'failed_retryable', 'manual_review'],
  credential_committed: ['session_verified', 'failed_retryable'],
  session_verified: ['completed', 'failed_retryable'],
  completed: [],
  failed_retryable: ['client_credentials_created', 'lockbox_ready', 'credential_committed', 'session_verified'],
  failed_terminal: [],
  manual_review: [],
}

function canonicalOperationRowKey(idempotencyKeyHash: string): string {
  return `${OPERATION_ROW_PREFIX}${idempotencyKeyHash}`
}

function parseJsonRecord<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function decodeReservationRegistry(
  row: ReservationRegistryRow | null,
): Record<string, ProvisioningReservation> {
  if (!row) return {}
  let json: string
  if (Number(row.schemaVersion) === 2) {
    const chunkCount = Number(row.reservationsChunkCount)
    if (!Number.isSafeInteger(chunkCount) || chunkCount < 1) {
      throw new Error('Provisioning reservation registry chunk metadata is invalid.')
    }
    const chunks = Array.from({ length: chunkCount }, (_, index) => {
      const key = `${RESERVATION_CHUNK_PREFIX}${String(index).padStart(3, '0')}`
      const chunk = row[key]
      if (typeof chunk !== 'string') {
        throw new Error(`Provisioning reservation registry chunk is missing: ${key}.`)
      }
      return chunk
    })
    json = chunks.join('')
  } else if (typeof row.reservationsJson === 'string') {
    json = row.reservationsJson
  } else {
    throw new Error('Provisioning reservation registry payload is missing.')
  }

  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('registry payload is not an object')
    }
    return parsed as Record<string, ProvisioningReservation>
  } catch (error) {
    throw new Error(`Provisioning reservation registry is corrupt: ${String(error)}`)
  }
}

export function encodeReservationRegistry(
  reservations: Record<string, ProvisioningReservation>,
  updatedAt = new Date().toISOString(),
): ReservationRegistryRow {
  const json = JSON.stringify(reservations)
  const chunks = Array.from(
    { length: Math.max(1, Math.ceil(json.length / RESERVATION_CHUNK_MAX_CHARS)) },
    (_, index) => json.slice(
      index * RESERVATION_CHUNK_MAX_CHARS,
      (index + 1) * RESERVATION_CHUNK_MAX_CHARS,
    ),
  )
  return {
    schemaVersion: 2,
    reservationsChunkCount: chunks.length,
    ...Object.fromEntries(
      chunks.map((chunk, index) => [
        `${RESERVATION_CHUNK_PREFIX}${String(index).padStart(3, '0')}`,
        chunk,
      ]),
    ),
    updatedAt,
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return value
}

export function computeProvisioningRequestDigest(value: Record<string, unknown>): string {
  const canonical = JSON.stringify(canonicalize(value))
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export class ProvisioningStore {
  constructor(private readonly credentials: CredentialStore) {}

  async reserveOrLoad(input: ProvisioningReservationInput): Promise<VersionedProvisioningOperation> {
    const idempotencyKeyHash = this.credentials.keyedHash('provisioning-idempotency', input.idempotencyKey)
    const rowKey = canonicalOperationRowKey(idempotencyKeyHash)
    const existing = await this.credentials.readVersionedRow(rowKey)
    if (existing) return this.assertMatchingOperation(this.mapOperation(existing.value), existing.etag, input.requestDigest)

    const now = new Date()
    const operationId = `op_${idempotencyKeyHash}`
    const reservationExpiresAt = new Date(
      now.getTime() + (input.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS),
    ).toISOString()
    const operation: ProvisioningOperation = {
      schemaVersion: 1,
      operationId,
      idempotencyKeyHash,
      requestDigest: input.requestDigest,
      state: 'reserved',
      normalizedHandle: input.normalizedHandle,
      emailHash: this.credentials.keyedHash('provisioning-email', input.normalizedEmail),
      expectedWebId: input.expectedWebId,
      expectedPodUrl: input.expectedPodUrl,
      stellarPublicKey: input.stellarPublicKey,
      configFingerprint: input.configFingerprint,
      descriptorSnapshotJson: JSON.stringify(input.descriptorSnapshot),
      encryptedResumeMaterialB64: this.credentials.encryptJson(input.resumeMaterial),
      stepTimestampsJson: JSON.stringify({ reserved: now.toISOString() }),
      attemptCount: 0,
      lastErrorCode: null,
      manualReviewReason: null,
      leaseOwner: null,
      leaseTokenHash: null,
      leaseEpoch: 0,
      leaseExpiresAt: null,
      reservationExpiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }

    try {
      await this.claimReservations(operation)
      const etag = await this.credentials.createVersionedRow(rowKey, operation)
      return { operation, etag }
    } catch (error) {
      if (error instanceof ConditionalWriteError && error.code === 'already_exists') {
        const raced = await this.credentials.readVersionedRow(rowKey)
        if (!raced) throw error
        return this.assertMatchingOperation(this.mapOperation(raced.value), raced.etag, input.requestDigest)
      }
      throw error
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<VersionedProvisioningOperation | null> {
    const hash = this.credentials.keyedHash('provisioning-idempotency', idempotencyKey)
    const stored = await this.credentials.readVersionedRow(canonicalOperationRowKey(hash))
    return stored ? { operation: this.mapOperation(stored.value), etag: stored.etag } : null
  }

  async isEmailReserved(normalizedEmail: string): Promise<boolean> {
    const registry = await this.credentials.readVersionedRow(REGISTRY_ROW_KEY)
    if (!registry) return false
    const reservations = decodeReservationRegistry(registry.value)
    const key = `email:${this.credentials.keyedHash('provisioning-email', normalizedEmail)}`
    const reservation = reservations[key]
    if (!reservation) return false
    if (reservation.disposition === 'committed') return true
    return Boolean(reservation.expiresAt && new Date(reservation.expiresAt).getTime() > Date.now())
  }

  async acquireLease(
    operation: VersionedProvisioningOperation,
    owner: string,
    ttlMs: number,
  ): Promise<{ operation: VersionedProvisioningOperation; lease: ProvisioningLease }> {
    const now = Date.now()
    const currentExpiry = operation.operation.leaseExpiresAt
      ? new Date(operation.operation.leaseExpiresAt).getTime()
      : 0
    if (currentExpiry > now && operation.operation.leaseOwner !== owner) {
      throw new ProvisioningConflictError('provisioning_in_progress', 'Provisioning is already in progress.')
    }
    if (operation.operation.state === 'css_account_pending' && currentExpiry <= now) {
      return this.markManualReview(operation, 'css_account_result_unknown').then(() => {
        throw new ProvisioningConflictError(
          'lease_lost',
          'The CSS account result is uncertain and requires operator review.',
        )
      })
    }

    const token = randomBytes(32).toString('base64url')
    const epoch = operation.operation.leaseEpoch + 1
    const expiresAt = new Date(now + ttlMs).toISOString()
    const updated = {
      ...operation.operation,
      leaseOwner: owner,
      leaseTokenHash: this.credentials.keyedHash('provisioning-lease', token),
      leaseEpoch: epoch,
      leaseExpiresAt: expiresAt,
      attemptCount: operation.operation.attemptCount + 1,
      updatedAt: new Date(now).toISOString(),
    }
    const etag = await this.credentials.replaceVersionedRow(
      canonicalOperationRowKey(updated.idempotencyKeyHash),
      updated,
      operation.etag,
    )
    return {
      operation: { operation: updated, etag },
      lease: { operationId: updated.operationId, owner, token, epoch, expiresAt },
    }
  }

  async transition(
    operation: VersionedProvisioningOperation,
    lease: ProvisioningLease,
    nextState: ProvisioningState,
    details: {
      errorCode?: string | null
      manualReviewReason?: string | null
      resumeMaterial?: unknown
    } = {},
  ): Promise<VersionedProvisioningOperation> {
    this.assertLease(operation.operation, lease)
    if (!LEGAL_TRANSITIONS[operation.operation.state].includes(nextState)) {
      throw new ProvisioningConflictError(
        'illegal_transition',
        `Provisioning cannot transition from ${operation.operation.state} to ${nextState}.`,
      )
    }
    const now = new Date().toISOString()
    const timestamps = parseJsonRecord<Record<string, string>>(
      operation.operation.stepTimestampsJson,
      {},
    )
    timestamps[nextState] = now
    const updated: ProvisioningOperation = {
      ...operation.operation,
      state: nextState,
      stepTimestampsJson: JSON.stringify(timestamps),
      lastErrorCode: details.errorCode ?? null,
      manualReviewReason: details.manualReviewReason ?? null,
      encryptedResumeMaterialB64: details.resumeMaterial === undefined
        ? operation.operation.encryptedResumeMaterialB64
        : this.credentials.encryptJson(details.resumeMaterial),
      updatedAt: now,
    }
    const etag = await this.credentials.replaceVersionedRow(
      canonicalOperationRowKey(updated.idempotencyKeyHash),
      updated,
      operation.etag,
    )
    return { operation: updated, etag }
  }

  async renewLease(
    operation: VersionedProvisioningOperation,
    lease: ProvisioningLease,
    ttlMs: number,
  ): Promise<{ operation: VersionedProvisioningOperation; lease: ProvisioningLease }> {
    this.assertLease(operation.operation, lease)
    const expiresAt = new Date(Date.now() + ttlMs).toISOString()
    const updated: ProvisioningOperation = {
      ...operation.operation,
      leaseExpiresAt: expiresAt,
      updatedAt: new Date().toISOString(),
    }
    const etag = await this.credentials.replaceVersionedRow(
      canonicalOperationRowKey(updated.idempotencyKeyHash),
      updated,
      operation.etag,
    )
    return {
      operation: { operation: updated, etag },
      lease: { ...lease, expiresAt },
    }
  }

  async releaseLease(
    operation: VersionedProvisioningOperation,
    lease: ProvisioningLease,
  ): Promise<VersionedProvisioningOperation> {
    this.assertLease(operation.operation, lease)
    const updated: ProvisioningOperation = {
      ...operation.operation,
      leaseOwner: null,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      updatedAt: new Date().toISOString(),
    }
    const etag = await this.credentials.replaceVersionedRow(
      canonicalOperationRowKey(updated.idempotencyKeyHash),
      updated,
      operation.etag,
    )
    return { operation: updated, etag }
  }

  async commitReservations(
    operation: VersionedProvisioningOperation,
    lease: ProvisioningLease,
  ): Promise<void> {
    this.assertLease(operation.operation, lease)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const registry = await this.credentials.readVersionedRow(REGISTRY_ROW_KEY)
      if (!registry) throw new Error('Provisioning reservation registry is missing.')
      const reservations = decodeReservationRegistry(registry.value)
      let matched = 0
      for (const reservation of Object.values(reservations)) {
        if (reservation.operationId !== operation.operation.operationId) continue
        reservation.disposition = 'committed'
        reservation.expiresAt = null
        matched += 1
      }
      if (matched !== 4) {
        throw new ProvisioningConflictError(
          'reservation_conflict',
          'The provisioning identity no longer owns all required reservations.',
        )
      }
      const next = encodeReservationRegistry(reservations)
      try {
        await this.credentials.replaceVersionedRow(REGISTRY_ROW_KEY, next, registry.etag)
        return
      } catch (error) {
        if (error instanceof ConditionalWriteError && error.code === 'etag_mismatch') continue
        throw error
      }
    }
    throw new ProvisioningConflictError(
      'provisioning_in_progress',
      'Provisioning reservations changed too frequently; retry the request.',
    )
  }

  async checkpointResumeMaterial(
    operation: VersionedProvisioningOperation,
    lease: ProvisioningLease,
    resumeMaterial: unknown,
  ): Promise<VersionedProvisioningOperation> {
    this.assertLease(operation.operation, lease)
    const updated: ProvisioningOperation = {
      ...operation.operation,
      encryptedResumeMaterialB64: this.credentials.encryptJson(resumeMaterial),
      updatedAt: new Date().toISOString(),
    }
    const etag = await this.credentials.replaceVersionedRow(
      canonicalOperationRowKey(updated.idempotencyKeyHash),
      updated,
      operation.etag,
    )
    return { operation: updated, etag }
  }

  async markManualReview(
    operation: VersionedProvisioningOperation,
    reason: string,
  ): Promise<VersionedProvisioningOperation> {
    const now = new Date().toISOString()
    const updated: ProvisioningOperation = {
      ...operation.operation,
      state: 'manual_review',
      lastErrorCode: 'manual_review',
      manualReviewReason: reason,
      leaseOwner: null,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      updatedAt: now,
    }
    const etag = await this.credentials.replaceVersionedRow(
      canonicalOperationRowKey(updated.idempotencyKeyHash),
      updated,
      operation.etag,
    )
    return { operation: updated, etag }
  }

  decryptResumeMaterial<T>(operation: ProvisioningOperation): T {
    return this.credentials.decryptJson<T>(operation.encryptedResumeMaterialB64)
  }

  private async claimReservations(operation: ProvisioningOperation): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const registry = await this.credentials.readVersionedRow(REGISTRY_ROW_KEY)
      const reservations = decodeReservationRegistry(registry?.value ?? null)
      const now = Date.now()
      for (const [key, reservation] of Object.entries(reservations)) {
        if (
          reservation.disposition === 'active' &&
          reservation.expiresAt &&
          new Date(reservation.expiresAt).getTime() <= now
        ) {
          delete reservations[key]
        }
      }
      const dimensions = [
        ['handle', this.credentials.keyedHash('provisioning-handle', operation.normalizedHandle)],
        ['email', operation.emailHash],
        ['webId', this.credentials.keyedHash('provisioning-webid', operation.expectedWebId)],
        ['podUrl', this.credentials.keyedHash('provisioning-podurl', operation.expectedPodUrl)],
      ] as const

      for (const [dimension, hash] of dimensions) {
        const key = `${dimension}:${hash}`
        const reservation = reservations[key]
        const expired = reservation?.expiresAt
          ? new Date(reservation.expiresAt).getTime() <= now
          : false
        if (
          reservation &&
          reservation.operationId !== operation.operationId &&
          (!expired || reservation.disposition === 'committed')
        ) {
          throw new ProvisioningConflictError(
            'reservation_conflict',
            `The requested ${dimension} is already reserved.`,
          )
        }
        if (
          reservation &&
          reservation.operationId === operation.operationId &&
          reservation.requestDigest !== operation.requestDigest
        ) {
          throw new ProvisioningConflictError(
            'idempotency_payload_conflict',
            'The idempotency key was already used for a different onboarding request.',
          )
        }
        reservations[key] = {
          operationId: operation.operationId,
          requestDigest: operation.requestDigest,
          disposition: 'active',
          expiresAt: operation.reservationExpiresAt,
        }
      }

      const next = encodeReservationRegistry(reservations)
      try {
        if (registry) {
          await this.credentials.replaceVersionedRow(REGISTRY_ROW_KEY, next, registry.etag)
        } else {
          await this.credentials.createVersionedRow(REGISTRY_ROW_KEY, next)
        }
        return
      } catch (error) {
        if (
          error instanceof ConditionalWriteError &&
          (error.code === 'already_exists' || error.code === 'etag_mismatch')
        ) {
          continue
        }
        throw error
      }
    }
    throw new ProvisioningConflictError(
      'provisioning_in_progress',
      'Provisioning reservations changed too frequently; retry the request.',
    )
  }

  private assertMatchingOperation(
    operation: ProvisioningOperation,
    etag: string,
    requestDigest: string,
  ): VersionedProvisioningOperation {
    if (operation.requestDigest !== requestDigest) {
      throw new ProvisioningConflictError(
        'idempotency_payload_conflict',
        'The idempotency key was already used for a different onboarding request.',
      )
    }
    return { operation, etag }
  }

  private assertLease(operation: ProvisioningOperation, lease: ProvisioningLease): void {
    const tokenHash = this.credentials.keyedHash('provisioning-lease', lease.token)
    if (
      operation.operationId !== lease.operationId ||
      operation.leaseOwner !== lease.owner ||
      operation.leaseEpoch !== lease.epoch ||
      operation.leaseTokenHash !== tokenHash ||
      !operation.leaseExpiresAt ||
      new Date(operation.leaseExpiresAt).getTime() <= Date.now()
    ) {
      throw new ProvisioningConflictError('lease_lost', 'The provisioning lease is no longer valid.')
    }
  }

  private mapOperation(value: Record<string, unknown>): ProvisioningOperation {
    const state = String(value.state ?? '')
    if (!PROVISIONING_STATES.includes(state as ProvisioningState)) {
      throw new Error(`Stored provisioning operation has invalid state ${state}.`)
    }
    return value as unknown as ProvisioningOperation
  }
}
