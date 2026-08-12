/**
 * @module credentialStore
 *
 * Durable, encrypted storage for per-user CSS client credentials.
 *
 * The Pod Access Proxy exchanges these credentials for DPoP-bound access
 * tokens on every session — they are the *only* durable Solid access material
 * in the system (the ephemeral CSS account password is discarded at
 * provisioning). Secrets are encrypted at rest with AES-256-GCM using a key
 * supplied via `JSS_CREDENTIALS_ENC_KEY` (Key Vault-sourced in staging/prod).
 *
 * Backends (selected by environment, zero runtime dependencies):
 *  - Azure Table Storage via REST + SAS URL (`JSS_CREDENTIALS_TABLE_SAS_URL`)
 *  - Local JSON file (`JSS_CREDENTIALS_FILE`) for the local profile
 *  - In-memory Map (tests / ephemeral dev)
 *
 * Deleting a record is the server-side session revocation path: the proxy and
 * login endpoints fail closed (`session_invalid` / 401) when no credentials
 * resolve for a WebID.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface StoredCredentialRecord {
  webId: string
  podUrl: string
  stellarPublicKey: string | null
  clientCredentialsId: string
  clientCredentialsSecret: string
  /** On-chain per-user lockb0x contract, anchored at provisioning. */
  userLockboxContractId: string | null
  lockboxFactoryContractId: string | null
  proofRootHex: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Server-held state for a browser session cookie. The cookie contains only a
 * random opaque token; this record holds the identity metadata needed to mint
 * a fresh origin-local NodeZero session after a first-party host handoff.
 */
export interface StoredBrowserSessionRecord {
  webId: string
  podUrl: string
  stellarPublicKey: string | null
  userLockboxContractId: string | null
  lockboxFactoryContractId: string | null
  proofRootHex: string | null
  expiresAt: string
  createdAt: string
}

interface PersistedRecord {
  webId: string
  podUrl: string
  stellarPublicKey: string | null
  clientCredentialsId: string
  /** base64(ver(1) || iv(12) || ciphertext+tag) */
  secretCiphertextB64: string
  userLockboxContractId: string | null
  lockboxFactoryContractId: string | null
  proofRootHex: string | null
  createdAt: string
  updatedAt: string
}

/** Index row payload: points a Stellar public key at its WebID row. */
interface PersistedIndexRecord {
  webIdsJson: string
}

const CIPHER_VERSION = 1
const BROWSER_SESSION_ROW_PREFIX = 'browser-session-'
const BROWSER_SESSION_WEBID_ROW_PREFIX = 'browser-session-webid-'

function decodeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim()
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex')
  }
  const decoded = Buffer.from(trimmed, 'base64')
  if (decoded.length === 32) return decoded
  throw new Error('JSS_CREDENTIALS_ENC_KEY must be 32 bytes (hex or base64).')
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([CIPHER_VERSION]), iv, ct, tag]).toString('base64')
}

export function decryptSecret(key: Buffer, payloadB64: string): string {
  const payload = Buffer.from(payloadB64, 'base64')
  if (payload.length < 1 + 12 + 16 || payload[0] !== CIPHER_VERSION) {
    throw new Error('Credential ciphertext is malformed or has an unsupported version.')
  }
  const iv = payload.subarray(1, 13)
  const tag = payload.subarray(payload.length - 16)
  const ct = payload.subarray(13, payload.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** Table-safe deterministic row key for a WebID. */
export function webIdRowKey(webId: string): string {
  return createHash('sha256').update(webId.trim()).digest('hex')
}

/** Table-safe deterministic row key for the Stellar-key index. */
export function stellarKeyRowKey(stellarPublicKey: string): string {
  return `spk-${createHash('sha256').update(stellarPublicKey.trim()).digest('hex')}`
}

function browserSessionRowKey(token: string): string {
  return `${BROWSER_SESSION_ROW_PREFIX}${createHash('sha256').update(token).digest('hex')}`
}

function browserSessionWebIdRowKey(webId: string): string {
  return `${BROWSER_SESSION_WEBID_ROW_PREFIX}${webIdRowKey(webId)}`
}

type BackendRow = Record<string, unknown>

interface VersionedBackendRow {
  value: BackendRow
  etag: string
}

export class ConditionalWriteError extends Error {
  readonly code: 'already_exists' | 'etag_mismatch'

  constructor(code: 'already_exists' | 'etag_mismatch', message: string) {
    super(message)
    this.name = 'ConditionalWriteError'
    this.code = code
  }
}

interface CredentialBackend {
  readonly kind: 'table' | 'file' | 'memory'
  get(rowKey: string): Promise<BackendRow | null>
  getVersioned(rowKey: string): Promise<VersionedBackendRow | null>
  put(rowKey: string, record: BackendRow): Promise<void>
  create(rowKey: string, record: BackendRow): Promise<string>
  replace(rowKey: string, record: BackendRow, ifMatch: string): Promise<string>
  delete(rowKey: string): Promise<boolean>
  deleteVersioned(rowKey: string, ifMatch: string): Promise<boolean>
}

// ---------------------------------------------------------------------------
// In-memory backend (tests / ephemeral local dev)
// ---------------------------------------------------------------------------

class MemoryBackend implements CredentialBackend {
  readonly kind = 'memory' as const
  private records = new Map<string, VersionedBackendRow>()
  private queue: Promise<unknown> = Promise.resolve()

  private serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => undefined)
    return Promise.resolve(next)
  }

  private nextEtag(): string {
    return `"${randomBytes(16).toString('hex')}"`
  }

  get(rowKey: string): Promise<BackendRow | null> {
    return this.getVersioned(rowKey).then((record) => record?.value ?? null)
  }

  getVersioned(rowKey: string): Promise<VersionedBackendRow | null> {
    return this.serialize(() => {
      const record = this.records.get(rowKey)
      return record ? { value: { ...record.value }, etag: record.etag } : null
    })
  }

  put(rowKey: string, record: BackendRow): Promise<void> {
    return this.serialize(() => {
      this.records.set(rowKey, { value: { ...record }, etag: this.nextEtag() })
    })
  }

  create(rowKey: string, record: BackendRow): Promise<string> {
    return this.serialize(() => {
      if (this.records.has(rowKey)) {
        throw new ConditionalWriteError('already_exists', `Row ${rowKey} already exists.`)
      }
      const etag = this.nextEtag()
      this.records.set(rowKey, { value: { ...record }, etag })
      return etag
    })
  }

  replace(rowKey: string, record: BackendRow, ifMatch: string): Promise<string> {
    return this.serialize(() => {
      const existing = this.records.get(rowKey)
      if (!existing || existing.etag !== ifMatch) {
        throw new ConditionalWriteError(
          'etag_mismatch',
          `Row ${rowKey} changed before replacement.`
        )
      }
      const etag = this.nextEtag()
      this.records.set(rowKey, { value: { ...record }, etag })
      return etag
    })
  }

  delete(rowKey: string): Promise<boolean> {
    return this.serialize(() => this.records.delete(rowKey))
  }

  deleteVersioned(rowKey: string, ifMatch: string): Promise<boolean> {
    return this.serialize(() => {
      const existing = this.records.get(rowKey)
      if (!existing) return false
      if (existing.etag !== ifMatch) {
        throw new ConditionalWriteError('etag_mismatch', `Row ${rowKey} changed before deletion.`)
      }
      return this.records.delete(rowKey)
    })
  }
}

// ---------------------------------------------------------------------------
// Local JSON file backend (local profile persistence)
// ---------------------------------------------------------------------------

class FileBackend implements CredentialBackend {
  readonly kind = 'file' as const
  private static readonly queues = new Map<string, Promise<unknown>>()
  private static readonly ETAG_FIELD = '__nzEtag'

  constructor(private readonly filePath: string) {}

  private async load(): Promise<Record<string, BackendRow>> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return JSON.parse(raw) as Record<string, BackendRow>
    } catch {
      return {}
    }
  }

  private async save(data: Record<string, BackendRow>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await rename(tmp, this.filePath)
  }

  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const current = FileBackend.queues.get(this.filePath) ?? Promise.resolve()
    const next = current.then(op, op)
    const settled = next.catch(() => undefined)
    FileBackend.queues.set(this.filePath, settled)
    void settled.finally(() => {
      if (FileBackend.queues.get(this.filePath) === settled) {
        FileBackend.queues.delete(this.filePath)
      }
    })
    return next
  }

  get(rowKey: string): Promise<BackendRow | null> {
    return this.getVersioned(rowKey).then((record) => record?.value ?? null)
  }

  getVersioned(rowKey: string): Promise<VersionedBackendRow | null> {
    return this.serialize(async () => {
      const data = await this.load()
      const stored = data[rowKey]
      if (!stored) return null
      const { [FileBackend.ETAG_FIELD]: rawEtag, ...value } = stored
      return {
        value,
        etag: typeof rawEtag === 'string' ? rawEtag : '"legacy"',
      }
    })
  }

  put(rowKey: string, record: BackendRow): Promise<void> {
    return this.serialize(async () => {
      const data = await this.load()
      data[rowKey] = { ...record, [FileBackend.ETAG_FIELD]: this.nextEtag() }
      await this.save(data)
    })
  }

  create(rowKey: string, record: BackendRow): Promise<string> {
    return this.serialize(async () => {
      const data = await this.load()
      if (rowKey in data) {
        throw new ConditionalWriteError('already_exists', `Row ${rowKey} already exists.`)
      }
      const etag = this.nextEtag()
      data[rowKey] = { ...record, [FileBackend.ETAG_FIELD]: etag }
      await this.save(data)
      return etag
    })
  }

  replace(rowKey: string, record: BackendRow, ifMatch: string): Promise<string> {
    return this.serialize(async () => {
      const data = await this.load()
      const existing = data[rowKey]
      const existingEtag =
        typeof existing?.[FileBackend.ETAG_FIELD] === 'string'
          ? existing[FileBackend.ETAG_FIELD]
          : '"legacy"'
      if (!existing || existingEtag !== ifMatch) {
        throw new ConditionalWriteError(
          'etag_mismatch',
          `Row ${rowKey} changed before replacement.`
        )
      }
      const etag = this.nextEtag()
      data[rowKey] = { ...record, [FileBackend.ETAG_FIELD]: etag }
      await this.save(data)
      return etag
    })
  }

  delete(rowKey: string): Promise<boolean> {
    return this.serialize(async () => {
      const data = await this.load()
      if (!(rowKey in data)) return false
      delete data[rowKey]
      await this.save(data)
      return true
    })
  }

  deleteVersioned(rowKey: string, ifMatch: string): Promise<boolean> {
    return this.serialize(async () => {
      const data = await this.load()
      const existing = data[rowKey]
      if (!existing) return false
      const existingEtag =
        typeof existing[FileBackend.ETAG_FIELD] === 'string'
          ? existing[FileBackend.ETAG_FIELD]
          : '"legacy"'
      if (existingEtag !== ifMatch) {
        throw new ConditionalWriteError('etag_mismatch', `Row ${rowKey} changed before deletion.`)
      }
      delete data[rowKey]
      await this.save(data)
      return true
    })
  }

  private nextEtag(): string {
    return `"${randomBytes(16).toString('hex')}"`
  }
}

// ---------------------------------------------------------------------------
// Azure Table Storage backend (REST + SAS, zero-dep)
// ---------------------------------------------------------------------------

const TABLE_PARTITION = 'nz-solid-credentials'

class AzureTableBackend implements CredentialBackend {
  readonly kind = 'table' as const
  private readonly tableUrl: string
  private readonly sasQuery: string

  /**
   * @param sasUrl Full table SAS URL, e.g.
   *   https://acct.table.core.windows.net/nzcredentials?sv=...&sig=...
   */
  constructor(sasUrl: string) {
    const parsed = new URL(sasUrl)
    if (!parsed.search || !parsed.search.includes('sig=')) {
      throw new Error('JSS_CREDENTIALS_TABLE_SAS_URL must include a SAS signature query.')
    }
    this.tableUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
    this.sasQuery = parsed.search.replace(/^\?/, '')
  }

  private entityUrl(rowKey: string): string {
    return `${this.tableUrl}(PartitionKey='${TABLE_PARTITION}',RowKey='${rowKey}')?${this.sasQuery}`
  }

  private tableRequestUrl(): string {
    return `${this.tableUrl}?${this.sasQuery}`
  }

  async get(rowKey: string): Promise<BackendRow | null> {
    return (await this.getVersioned(rowKey))?.value ?? null
  }

  async getVersioned(rowKey: string): Promise<VersionedBackendRow | null> {
    const res = await fetch(this.entityUrl(rowKey), {
      headers: { accept: 'application/json;odata=nometadata' },
    })
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`Credential store read failed (${res.status}): ${await res.text()}`)
    }
    const entity = (await res.json()) as Record<string, unknown>
    const row: BackendRow = {}
    for (const [key, value] of Object.entries(entity)) {
      if (key === 'PartitionKey' || key === 'RowKey' || key.startsWith('odata.')) continue
      row[key] = value === '' ? null : value
    }
    const etag =
      res.headers.get('etag') ??
      (typeof entity['odata.etag'] === 'string' ? entity['odata.etag'] : null)
    if (!etag) throw new Error('Credential store read did not return an ETag.')
    return { value: row, etag }
  }

  async put(rowKey: string, record: BackendRow): Promise<void> {
    // Insert-or-replace: idempotent upsert semantics.
    const entity: Record<string, unknown> = {
      PartitionKey: TABLE_PARTITION,
      RowKey: rowKey,
    }
    for (const [key, value] of Object.entries(record)) {
      entity[key] = value ?? ''
    }
    const res = await fetch(this.entityUrl(rowKey), {
      method: 'PUT',
      headers: {
        accept: 'application/json;odata=nometadata',
        'content-type': 'application/json',
      },
      body: JSON.stringify(entity),
    })
    if (!res.ok && res.status !== 204) {
      throw new Error(`Credential store write failed (${res.status}): ${await res.text()}`)
    }
  }

  async create(rowKey: string, record: BackendRow): Promise<string> {
    const entity = this.toEntity(rowKey, record)
    const res = await fetch(this.tableRequestUrl(), {
      method: 'POST',
      headers: {
        accept: 'application/json;odata=nometadata',
        'content-type': 'application/json',
        prefer: 'return-no-content',
      },
      body: JSON.stringify(entity),
    })
    if (res.status === 409) {
      throw new ConditionalWriteError('already_exists', `Row ${rowKey} already exists.`)
    }
    if (!res.ok && res.status !== 204) {
      throw new Error(`Credential store create failed (${res.status}): ${await res.text()}`)
    }
    return res.headers.get('etag') ?? '"created"'
  }

  async replace(rowKey: string, record: BackendRow, ifMatch: string): Promise<string> {
    const res = await fetch(this.entityUrl(rowKey), {
      method: 'PUT',
      headers: {
        accept: 'application/json;odata=nometadata',
        'content-type': 'application/json',
        'if-match': ifMatch,
      },
      body: JSON.stringify(this.toEntity(rowKey, record)),
    })
    if (res.status === 404 || res.status === 412) {
      throw new ConditionalWriteError('etag_mismatch', `Row ${rowKey} changed before replacement.`)
    }
    if (!res.ok && res.status !== 204) {
      throw new Error(`Credential store replace failed (${res.status}): ${await res.text()}`)
    }
    return res.headers.get('etag') ?? '"replaced"'
  }

  async delete(rowKey: string): Promise<boolean> {
    const res = await fetch(this.entityUrl(rowKey), {
      method: 'DELETE',
      headers: { 'if-match': '*' },
    })
    if (res.status === 404) return false
    if (!res.ok && res.status !== 204) {
      throw new Error(`Credential store delete failed (${res.status}): ${await res.text()}`)
    }
    return true
  }

  async deleteVersioned(rowKey: string, ifMatch: string): Promise<boolean> {
    const res = await fetch(this.entityUrl(rowKey), {
      method: 'DELETE',
      headers: { 'if-match': ifMatch },
    })
    if (res.status === 404) return false
    if (res.status === 412) {
      throw new ConditionalWriteError('etag_mismatch', `Row ${rowKey} changed before deletion.`)
    }
    if (!res.ok && res.status !== 204) {
      throw new Error(`Credential store delete failed (${res.status}): ${await res.text()}`)
    }
    return true
  }

  private toEntity(rowKey: string, record: BackendRow): Record<string, unknown> {
    const entity: Record<string, unknown> = {
      PartitionKey: TABLE_PARTITION,
      RowKey: rowKey,
    }
    for (const [key, value] of Object.entries(record)) entity[key] = value ?? ''
    return entity
  }
}

// ---------------------------------------------------------------------------
// Public store
// ---------------------------------------------------------------------------

export interface CredentialStoreOptions {
  encryptionKey?: string
  tableSasUrl?: string
  filePath?: string
}

export class CredentialStore {
  private readonly key: Buffer
  private readonly backend: CredentialBackend
  private readonly keyIsEphemeral: boolean

  constructor(options: CredentialStoreOptions = {}) {
    const rawKey = (options.encryptionKey ?? process.env.JSS_CREDENTIALS_ENC_KEY ?? '').trim()
    const tableSasUrl = (
      options.tableSasUrl ??
      process.env.JSS_CREDENTIALS_TABLE_SAS_URL ??
      ''
    ).trim()
    const filePath = (options.filePath ?? process.env.JSS_CREDENTIALS_FILE ?? '').trim()

    if (rawKey) {
      this.key = decodeKeyMaterial(rawKey)
      this.keyIsEphemeral = false
    } else {
      if (tableSasUrl || filePath) {
        // Durable backends require a stable key — fail closed rather than
        // writing records that can never be decrypted after a restart.
        throw new Error(
          'JSS_CREDENTIALS_ENC_KEY is required when a durable credential backend is configured.'
        )
      }
      this.key = randomBytes(32)
      this.keyIsEphemeral = true
    }

    if (tableSasUrl) {
      this.backend = new AzureTableBackend(tableSasUrl)
    } else if (filePath) {
      this.backend = new FileBackend(filePath)
    } else {
      this.backend = new MemoryBackend()
    }
  }

  get backendKind(): 'table' | 'file' | 'memory' {
    return this.backend.kind
  }

  get usesEphemeralKey(): boolean {
    return this.keyIsEphemeral
  }

  keyedHash(scope: string, value: string): string {
    return createHmac('sha256', this.key)
      .update(`${scope.trim()}\0${value.trim()}`, 'utf8')
      .digest('hex')
  }

  encryptJson(value: unknown): string {
    return encryptSecret(this.key, JSON.stringify(value))
  }

  decryptJson<T>(ciphertextB64: string): T {
    return JSON.parse(decryptSecret(this.key, ciphertextB64)) as T
  }

  async readVersionedRow(rowKey: string): Promise<VersionedBackendRow | null> {
    return this.backend.getVersioned(rowKey)
  }

  async createVersionedRow(rowKey: string, value: object): Promise<string> {
    return this.backend.create(rowKey, { ...value })
  }

  async replaceVersionedRow(rowKey: string, value: object, ifMatch: string): Promise<string> {
    return this.backend.replace(rowKey, { ...value }, ifMatch)
  }

  async deleteVersionedRow(rowKey: string, ifMatch: string): Promise<boolean> {
    return this.backend.deleteVersioned(rowKey, ifMatch)
  }

  async save(record: Omit<StoredCredentialRecord, 'createdAt' | 'updatedAt'>): Promise<void> {
    const rowKey = webIdRowKey(record.webId)
    const now = new Date().toISOString()
    const existing = await this.backend.get(rowKey)
    const persisted: PersistedRecord = {
      webId: record.webId.trim(),
      podUrl: record.podUrl.trim(),
      stellarPublicKey: record.stellarPublicKey?.trim() || null,
      clientCredentialsId: record.clientCredentialsId,
      secretCiphertextB64: encryptSecret(this.key, record.clientCredentialsSecret),
      userLockboxContractId: record.userLockboxContractId?.trim() || null,
      lockboxFactoryContractId: record.lockboxFactoryContractId?.trim() || null,
      proofRootHex: record.proofRootHex?.trim() || null,
      createdAt: typeof existing?.createdAt === 'string' ? existing.createdAt : now,
      updatedAt: now,
    }
    await this.backend.put(rowKey, persisted as unknown as BackendRow)

    // Secondary index: Stellar public key -> WebID, so returning users can
    // sign in from any device holding only their keypair.
    if (persisted.stellarPublicKey) {
      const existingIndex = await this.backend.get(stellarKeyRowKey(persisted.stellarPublicKey))
      const previousIds = this.readIndexedWebIds(existingIndex)
      const index: PersistedIndexRecord = {
        webIdsJson: JSON.stringify([
          persisted.webId,
          ...previousIds.filter((id) => id !== persisted.webId),
        ]),
      }
      await this.backend.put(
        stellarKeyRowKey(persisted.stellarPublicKey),
        index as unknown as BackendRow
      )
    }
  }

  private mapRecord(persisted: BackendRow): StoredCredentialRecord {
    return {
      webId: String(persisted.webId ?? ''),
      podUrl: String(persisted.podUrl ?? ''),
      stellarPublicKey:
        typeof persisted.stellarPublicKey === 'string' && persisted.stellarPublicKey
          ? persisted.stellarPublicKey
          : null,
      clientCredentialsId: String(persisted.clientCredentialsId ?? ''),
      clientCredentialsSecret: decryptSecret(this.key, String(persisted.secretCiphertextB64 ?? '')),
      userLockboxContractId:
        typeof persisted.userLockboxContractId === 'string' && persisted.userLockboxContractId
          ? persisted.userLockboxContractId
          : null,
      lockboxFactoryContractId:
        typeof persisted.lockboxFactoryContractId === 'string' && persisted.lockboxFactoryContractId
          ? persisted.lockboxFactoryContractId
          : null,
      proofRootHex:
        typeof persisted.proofRootHex === 'string' && persisted.proofRootHex
          ? persisted.proofRootHex
          : null,
      createdAt: String(persisted.createdAt ?? ''),
      updatedAt: String(persisted.updatedAt ?? ''),
    }
  }

  async findByWebId(webId: string): Promise<StoredCredentialRecord | null> {
    const persisted = await this.backend.get(webIdRowKey(webId))
    if (!persisted) return null
    return this.mapRecord(persisted)
  }

  /** Resolves credentials from a Stellar public key via the index row. */
  async findByStellarPublicKey(stellarPublicKey: string): Promise<StoredCredentialRecord | null> {
    const index = await this.backend.get(stellarKeyRowKey(stellarPublicKey))
    const webIds = this.readIndexedWebIds(index)
    const webId = webIds[0] ?? null
    if (!webId) return null
    return this.findByWebId(webId)
  }

  /** Resolves all known credentials for a Stellar public key, newest-first. */
  async findAllByStellarPublicKey(stellarPublicKey: string): Promise<StoredCredentialRecord[]> {
    const index = await this.backend.get(stellarKeyRowKey(stellarPublicKey))
    const webIds = this.readIndexedWebIds(index)
    if (webIds.length === 0) return []

    const records = await Promise.all(webIds.map((webId) => this.findByWebId(webId)))
    return records.filter((record): record is StoredCredentialRecord => record !== null)
  }

  async saveBrowserSession(
    token: string,
    record: Omit<StoredBrowserSessionRecord, 'createdAt'>
  ): Promise<void> {
    const rowKey = browserSessionRowKey(token)
    const persisted: StoredBrowserSessionRecord = {
      webId: record.webId.trim(),
      podUrl: record.podUrl.trim(),
      stellarPublicKey: record.stellarPublicKey?.trim() || null,
      userLockboxContractId: record.userLockboxContractId?.trim() || null,
      lockboxFactoryContractId: record.lockboxFactoryContractId?.trim() || null,
      proofRootHex: record.proofRootHex?.trim() || null,
      expiresAt: record.expiresAt,
      createdAt: new Date().toISOString(),
    }
    await this.backend.put(rowKey, persisted as unknown as BackendRow)

    const indexKey = browserSessionWebIdRowKey(persisted.webId)
    const existing = await this.backend.get(indexKey)
    const tokenRows = this.readBrowserSessionRows(existing)
    await this.backend.put(indexKey, {
      tokenRowsJson: JSON.stringify([rowKey, ...tokenRows.filter((value) => value !== rowKey)]),
    })
  }

  async findBrowserSession(token: string): Promise<StoredBrowserSessionRecord | null> {
    const rowKey = browserSessionRowKey(token)
    const persisted = await this.backend.get(rowKey)
    if (!persisted) return null
    const expiresAt = typeof persisted.expiresAt === 'string' ? persisted.expiresAt : ''
    if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
      await this.deleteBrowserSessionByRowKey(
        rowKey,
        typeof persisted.webId === 'string' ? persisted.webId : ''
      )
      return null
    }
    return {
      webId: String(persisted.webId ?? ''),
      podUrl: String(persisted.podUrl ?? ''),
      stellarPublicKey:
        typeof persisted.stellarPublicKey === 'string' && persisted.stellarPublicKey
          ? persisted.stellarPublicKey
          : null,
      userLockboxContractId:
        typeof persisted.userLockboxContractId === 'string' && persisted.userLockboxContractId
          ? persisted.userLockboxContractId
          : null,
      lockboxFactoryContractId:
        typeof persisted.lockboxFactoryContractId === 'string' && persisted.lockboxFactoryContractId
          ? persisted.lockboxFactoryContractId
          : null,
      proofRootHex:
        typeof persisted.proofRootHex === 'string' && persisted.proofRootHex
          ? persisted.proofRootHex
          : null,
      expiresAt,
      createdAt: String(persisted.createdAt ?? ''),
    }
  }

  async revokeBrowserSession(token: string): Promise<boolean> {
    const rowKey = browserSessionRowKey(token)
    const existing = await this.backend.get(rowKey)
    return this.deleteBrowserSessionByRowKey(
      rowKey,
      typeof existing?.webId === 'string' ? existing.webId : ''
    )
  }

  async revokeBrowserSessionsByWebId(webId: string): Promise<number> {
    const indexKey = browserSessionWebIdRowKey(webId)
    const index = await this.backend.get(indexKey)
    const tokenRows = this.readBrowserSessionRows(index)
    await Promise.all(tokenRows.map((rowKey) => this.backend.delete(rowKey)))
    await this.backend.delete(indexKey)
    return tokenRows.length
  }

  /** Server-side revocation: removing the record invalidates every session. */
  async revokeByWebId(webId: string): Promise<boolean> {
    const existing = await this.backend.get(webIdRowKey(webId))
    const removed = await this.backend.delete(webIdRowKey(webId))
    const spk =
      existing && typeof existing.stellarPublicKey === 'string' ? existing.stellarPublicKey : ''
    if (spk) {
      const keyRow = stellarKeyRowKey(spk)
      const existingIndex = await this.backend.get(keyRow)
      const remaining = this.readIndexedWebIds(existingIndex).filter(
        (indexedWebId) => indexedWebId !== webId
      )
      if (remaining.length === 0) {
        await this.backend.delete(keyRow).catch(() => false)
      } else {
        await this.backend.put(keyRow, { webIdsJson: JSON.stringify(remaining) }).catch(() => false)
      }
    }
    await this.revokeBrowserSessionsByWebId(webId)
    return removed
  }

  private async deleteBrowserSessionByRowKey(rowKey: string, webId: string): Promise<boolean> {
    const removed = await this.backend.delete(rowKey)
    if (!webId) return removed
    const indexKey = browserSessionWebIdRowKey(webId)
    const index = await this.backend.get(indexKey)
    const remaining = this.readBrowserSessionRows(index).filter((value) => value !== rowKey)
    if (remaining.length === 0) {
      await this.backend.delete(indexKey)
    } else {
      await this.backend.put(indexKey, { tokenRowsJson: JSON.stringify(remaining) })
    }
    return removed
  }

  private readBrowserSessionRows(index: BackendRow | null): string[] {
    if (typeof index?.tokenRowsJson !== 'string') return []
    try {
      const parsed: unknown = JSON.parse(index.tokenRowsJson)
      return Array.isArray(parsed)
        ? parsed.filter(
            (value): value is string =>
              typeof value === 'string' && value.startsWith(BROWSER_SESSION_ROW_PREFIX)
          )
        : []
    } catch {
      return []
    }
  }

  private readIndexedWebIds(index: BackendRow | null): string[] {
    if (!index) return []
    if (typeof index.webIdsJson === 'string' && index.webIdsJson.length > 0) {
      try {
        const parsed: unknown = JSON.parse(index.webIdsJson)
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item): item is string => typeof item === 'string' && item.length > 0
          )
        }
      } catch {
        return []
      }
    }
    return []
  }
}
