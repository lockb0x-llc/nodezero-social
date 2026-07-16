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

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
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
  webId: string
}

const CIPHER_VERSION = 1

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

type BackendRow = Record<string, unknown>

interface CredentialBackend {
  readonly kind: 'table' | 'file' | 'memory'
  get(rowKey: string): Promise<BackendRow | null>
  put(rowKey: string, record: BackendRow): Promise<void>
  delete(rowKey: string): Promise<boolean>
}

// ---------------------------------------------------------------------------
// In-memory backend (tests / ephemeral local dev)
// ---------------------------------------------------------------------------

class MemoryBackend implements CredentialBackend {
  readonly kind = 'memory' as const
  private records = new Map<string, BackendRow>()

  get(rowKey: string): Promise<BackendRow | null> {
    return Promise.resolve(this.records.get(rowKey) ?? null)
  }

  put(rowKey: string, record: BackendRow): Promise<void> {
    this.records.set(rowKey, record)
    return Promise.resolve()
  }

  delete(rowKey: string): Promise<boolean> {
    return Promise.resolve(this.records.delete(rowKey))
  }
}

// ---------------------------------------------------------------------------
// Local JSON file backend (local profile persistence)
// ---------------------------------------------------------------------------

class FileBackend implements CredentialBackend {
  readonly kind = 'file' as const
  private queue: Promise<unknown> = Promise.resolve()

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
    const next = this.queue.then(op, op)
    this.queue = next.catch(() => undefined)
    return next
  }

  get(rowKey: string): Promise<BackendRow | null> {
    return this.serialize(async () => {
      const data = await this.load()
      return data[rowKey] ?? null
    })
  }

  put(rowKey: string, record: BackendRow): Promise<void> {
    return this.serialize(async () => {
      const data = await this.load()
      data[rowKey] = record
      await this.save(data)
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

  async get(rowKey: string): Promise<BackendRow | null> {
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
    return row
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
    const tableSasUrl = (options.tableSasUrl ?? process.env.JSS_CREDENTIALS_TABLE_SAS_URL ?? '').trim()
    const filePath = (options.filePath ?? process.env.JSS_CREDENTIALS_FILE ?? '').trim()

    if (rawKey) {
      this.key = decodeKeyMaterial(rawKey)
      this.keyIsEphemeral = false
    } else {
      if (tableSasUrl || filePath) {
        // Durable backends require a stable key — fail closed rather than
        // writing records that can never be decrypted after a restart.
        throw new Error(
          'JSS_CREDENTIALS_ENC_KEY is required when a durable credential backend is configured.',
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
      const index: PersistedIndexRecord = { webId: persisted.webId }
      await this.backend.put(stellarKeyRowKey(persisted.stellarPublicKey), index as unknown as BackendRow)
    }
  }

  private mapRecord(persisted: BackendRow): StoredCredentialRecord {
    return {
      webId: String(persisted.webId ?? ''),
      podUrl: String(persisted.podUrl ?? ''),
      stellarPublicKey: typeof persisted.stellarPublicKey === 'string' && persisted.stellarPublicKey ? persisted.stellarPublicKey : null,
      clientCredentialsId: String(persisted.clientCredentialsId ?? ''),
      clientCredentialsSecret: decryptSecret(this.key, String(persisted.secretCiphertextB64 ?? '')),
      userLockboxContractId: typeof persisted.userLockboxContractId === 'string' && persisted.userLockboxContractId ? persisted.userLockboxContractId : null,
      lockboxFactoryContractId: typeof persisted.lockboxFactoryContractId === 'string' && persisted.lockboxFactoryContractId ? persisted.lockboxFactoryContractId : null,
      proofRootHex: typeof persisted.proofRootHex === 'string' && persisted.proofRootHex ? persisted.proofRootHex : null,
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
    const webId = index && typeof index.webId === 'string' ? index.webId : null
    if (!webId) return null
    return this.findByWebId(webId)
  }

  /** Server-side revocation: removing the record invalidates every session. */
  async revokeByWebId(webId: string): Promise<boolean> {
    const existing = await this.backend.get(webIdRowKey(webId))
    const removed = await this.backend.delete(webIdRowKey(webId))
    const spk = existing && typeof existing.stellarPublicKey === 'string' ? existing.stellarPublicKey : ''
    if (spk) {
      await this.backend.delete(stellarKeyRowKey(spk)).catch(() => false)
    }
    return removed
  }
}
