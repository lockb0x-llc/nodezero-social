import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  sanitizeCommunityDirectoryRecord,
  shouldReplaceDirectoryRecord,
  type CommunityDirectoryPersistence,
} from './communityDirectoryPersistence.js'

export interface CommunityDirectoryRecord {
  webId: string
  podUrl: string
  issuer: string
  listed: boolean
  listedAt?: string
  updatedAt: string
  displayName?: string
  avatarUrl?: string
  publicInterests?: string[]
  capabilities?: string[]
  inboxUrl?: string
  manifestUrl?: string
  manifestPublishedAt?: string
  manifestExpiresAt?: string
  publicationUpdatedAt?: string
  publicationRevision?: number
  suppressionRevision?: number
  suppressedAt?: string
  sourceRevision?: string
  removedAt?: string
}

export interface CommunityDirectoryProjectionInput {
  webId: string
  podUrl: string
  issuer: string
  publicListing: boolean
  publicIndexing: boolean
  publicationUpdatedAt: string
  publicationRevision?: number
  suppressed?: boolean
  manifest: {
    publishedAt: string
    expiresAt: string
    displayName?: string
    avatarUrl?: string
    publicInterests?: string[]
    capabilities?: string[]
    inboxUrl?: string
  } | null
  manifestUrl: string
  sourceRevision?: string
  now?: Date
}

export interface CommunityDirectoryIndex {
  version: 1
  generatedAt: string
  members: CommunityDirectoryPublicRecord[]
}

export interface CommunityDirectoryPublicRecord {
  webId: string
  displayName?: string
  avatarUrl?: string
  publicInterests?: string[]
}

export interface CommunityDirectoryPage {
  version: 1
  generatedAt: string
  members: CommunityDirectoryPublicRecord[]
  nextCursor: string | null
  etag: string
}

interface PersistedCommunityDirectory {
  version: 1
  records: CommunityDirectoryRecord[]
}

const MAX_MANIFEST_TTL_MS = 7 * 24 * 60 * 60_000
const MAX_MANIFEST_CLOCK_SKEW_MS = 5 * 60_000

export class CommunityDirectoryStore {
  private readonly records = new Map<string, CommunityDirectoryRecord>()
  private readonly committedRecords = new Map<string, CommunityDirectoryRecord>()
  private readonly durableRecords = new Map<string, CommunityDirectoryRecord>()
  private readonly persistenceFilePath: string
  private readonly persistence: CommunityDirectoryPersistence | undefined
  private pendingPersistence: Promise<void> = Promise.resolve()
  private reloadInFlight: Promise<void> | null = null
  private forcedReloadAfterInFlight: Promise<void> | null = null
  private lastReloadAtMs = 0
  private readonly reloadTtlMs = 5_000
  private probeInFlight: Promise<void> | null = null
  private lastProbeAtMs = 0
  private readonly probeTtlMs = 60_000

  constructor(options?: {
    persistenceFilePath?: string
    persistence?: CommunityDirectoryPersistence
  }) {
    this.persistenceFilePath =
      options?.persistenceFilePath?.trim() ||
      join(process.cwd(), '.data', 'community-directory.json')
    this.persistence = options?.persistence
    if (!this.persistence) this.loadFromDisk()
  }

  async reload(force = false): Promise<void> {
    if (!this.persistence) return
    if (!force && Date.now() - this.lastReloadAtMs < this.reloadTtlMs) return
    if (this.reloadInFlight) {
      if (!force) return this.reloadInFlight
      if (!this.forcedReloadAfterInFlight) {
        const currentReload = this.reloadInFlight
        const followUp = currentReload
          .then(() => this.reload(true))
          .finally(() => {
            if (this.forcedReloadAfterInFlight === followUp) {
              this.forcedReloadAfterInFlight = null
            }
          })
        this.forcedReloadAfterInFlight = followUp
      }
      return this.forcedReloadAfterInFlight
    }
    this.reloadInFlight = this.persistence
      .loadRecords()
      .then((records) => {
        const observedWebIds = new Set(records.map((record) => record.webId))
        for (const record of records) {
          this.mergeRecord(this.records, record)
          this.durableRecords.set(record.webId, { ...record })
          const local = this.records.get(record.webId)
          const publicRecord =
            local && !local.listed && shouldReplaceDirectoryRecord(record, local)
              ? local
              : record
          this.committedRecords.set(record.webId, { ...publicRecord })
        }
        for (const webId of this.durableRecords.keys()) {
          if (observedWebIds.has(webId)) continue
          this.durableRecords.delete(webId)
          this.committedRecords.delete(webId)
        }
        this.lastReloadAtMs = Date.now()
      })
      .finally(() => {
        this.reloadInFlight = null
      })
    return this.reloadInFlight
  }

  async flush(): Promise<void> {
    await this.pendingPersistence
  }

  async reloadRecord(webId: string, replaceWorking = false): Promise<void> {
    if (!this.persistence) return
    const record = await this.persistence.loadRecord(webId)
    if (record) {
      const local = this.records.get(record.webId)
      const privacyOverlay =
        local && !local.listed && shouldReplaceDirectoryRecord(record, local) ? local : null
      if (replaceWorking) {
        this.records.set(record.webId, { ...(privacyOverlay ?? record) })
      } else {
        this.mergeRecord(this.records, record)
      }
      this.committedRecords.set(record.webId, { ...(privacyOverlay ?? record) })
      this.durableRecords.set(record.webId, { ...record })
    } else {
      const working = this.records.get(webId)
      if (working && !working.listed) {
        this.committedRecords.set(webId, { ...working })
      } else {
        this.committedRecords.delete(webId)
      }
      this.durableRecords.delete(webId)
    }
  }

  async probe(): Promise<void> {
    if (!this.persistence) return
    if (Date.now() - this.lastProbeAtMs < this.probeTtlMs) return
    if (this.probeInFlight) return this.probeInFlight
    this.probeInFlight = this.persistence
      .probe()
      .then(() => {
        this.lastProbeAtMs = Date.now()
      })
      .finally(() => {
        this.probeInFlight = null
      })
    return this.probeInFlight
  }

  private loadFromDisk(): void {
    try {
      const raw = readFileSync(this.persistenceFilePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedCommunityDirectory>
      const records = Array.isArray(parsed.records) ? parsed.records : []
      for (const candidate of records) {
        const record = sanitizeCommunityDirectoryRecord(candidate)
        if (!record) continue
        this.records.set(record.webId, record)
        this.committedRecords.set(record.webId, { ...record })
        this.durableRecords.set(record.webId, { ...record })
      }
    } catch {
      // Missing or malformed file should not block provisioning startup.
    }
  }

  private persistToDisk(): void {
    if (this.persistence) return
    const payload: PersistedCommunityDirectory = {
      version: 1,
      records: Array.from(this.records.values()),
    }

    const directory = dirname(this.persistenceFilePath)
    mkdirSync(directory, { recursive: true })

    const tempPath = `${this.persistenceFilePath}.tmp`
    writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8')
    try {
      renameSync(tempPath, this.persistenceFilePath)
    } catch {
      // Windows can intermittently reject renames when scanners/processes touch
      // the destination. Fall back to direct write to keep persistence available.
      writeFileSync(this.persistenceFilePath, JSON.stringify(payload, null, 2), 'utf8')
      try {
        unlinkSync(tempPath)
      } catch {
        // Best-effort cleanup only.
      }
    }
    this.committedRecords.clear()
    this.durableRecords.clear()
    for (const record of this.records.values()) {
      this.committedRecords.set(record.webId, { ...record })
      this.durableRecords.set(record.webId, { ...record })
    }
  }

  private persistRecord(record: CommunityDirectoryRecord): void {
    if (!this.persistence) {
      this.persistToDisk()
      return
    }
    const snapshot = { ...record }
    this.pendingPersistence = this.pendingPersistence
      .catch(() => undefined)
      .then(() => this.persistence!.upsertRecord(snapshot))
  }

  private mergeRecord(
    target: Map<string, CommunityDirectoryRecord>,
    incoming: CommunityDirectoryRecord
  ): void {
    const current = target.get(incoming.webId)
    if (!current || shouldReplaceDirectoryRecord(current, incoming)) {
      target.set(incoming.webId, { ...incoming })
    }
  }

  seedRecord(input: { webId: string; podUrl: string; issuer: string }): CommunityDirectoryRecord {
    const now = new Date().toISOString()
    const existing = this.records.get(input.webId)
    if (existing) {
      existing.podUrl = input.podUrl
      existing.issuer = input.issuer
      existing.updatedAt = now
      this.records.set(input.webId, existing)
      this.persistRecord(existing)
      return existing
    }

    const record: CommunityDirectoryRecord = {
      webId: input.webId,
      podUrl: input.podUrl,
      issuer: input.issuer,
      listed: false,
      updatedAt: now,
    }

    this.records.set(input.webId, record)
    this.persistRecord(record)
    return record
  }

  setListing(webId: string, listed: boolean): CommunityDirectoryRecord | null {
    const record = this.records.get(webId)
    if (!record) return null

    const now = new Date().toISOString()
    record.listed = listed
    record.updatedAt = now
    if (listed) {
      record.listedAt = record.listedAt ?? now
      delete record.removedAt
    } else {
      delete record.listedAt
      record.removedAt = now
      record.suppressedAt = now
      record.suppressionRevision = record.publicationRevision ?? 0
    }

    this.records.set(webId, record)
    if (!listed) this.committedRecords.set(webId, { ...record })
    this.persistRecord(record)
    return record
  }

  refreshProjection(input: CommunityDirectoryProjectionInput): CommunityDirectoryRecord {
    const now = input.now ?? new Date()
    const existing = this.records.get(input.webId)
    const manifestIsCurrent = isBoundedCurrentManifest(input.manifest, now.getTime())
    const listed =
      input.publicListing &&
      typeof input.publicationRevision === 'number' &&
      manifestIsCurrent
    const record: CommunityDirectoryRecord = {
      webId: input.webId,
      podUrl: input.podUrl,
      issuer: input.issuer,
      listed,
      updatedAt: now.toISOString(),
      publicationUpdatedAt: input.publicationUpdatedAt,
      ...(typeof input.publicationRevision === 'number'
        ? { publicationRevision: input.publicationRevision }
        : {}),
      manifestUrl: input.manifestUrl,
      ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
    }

    if (listed && input.manifest) {
      record.listedAt = existing?.listedAt ?? now.toISOString()
      delete record.removedAt
      record.manifestPublishedAt = input.manifest.publishedAt
      record.manifestExpiresAt = input.manifest.expiresAt
      if (input.manifest.displayName) record.displayName = input.manifest.displayName
      if (input.manifest.avatarUrl) record.avatarUrl = input.manifest.avatarUrl
    } else {
      delete record.listedAt
      if (existing?.listed) record.removedAt = now.toISOString()
      else if (existing?.removedAt) record.removedAt = existing.removedAt
    }
    if (input.suppressed) {
      record.suppressedAt = now.toISOString()
      record.suppressionRevision =
        input.publicationRevision ??
        existing?.publicationRevision ??
        existing?.suppressionRevision ??
        0
    } else if (
      listed &&
      (existing?.suppressionRevision ?? -1) < (input.publicationRevision ?? 0)
    ) {
      delete record.suppressedAt
      delete record.suppressionRevision
    } else if (existing?.suppressedAt) {
      record.suppressedAt = existing.suppressedAt
      if (existing.suppressionRevision !== undefined) {
        record.suppressionRevision = existing.suppressionRevision
      }
      record.listed = false
      delete record.listedAt
    }

    if (existing && !shouldReplaceDirectoryRecord(existing, record)) return existing

    this.records.set(input.webId, record)
    if (!record.listed) this.committedRecords.set(input.webId, { ...record })
    this.persistRecord(record)
    return record
  }

  buildPublicIndex(): CommunityDirectoryIndex {
    const nowMs = Date.now()
    const members = Array.from(this.committedRecords.values())
      .filter((entry) => isPubliclyCurrent(entry, nowMs))
      .sort((a, b) => a.webId.localeCompare(b.webId))
      .map(toPublicDirectoryRecord)

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      members,
    }
  }

  buildPublicPage(
    input: {
      cursor?: string
      limit?: number
      now?: Date
      include?: (record: CommunityDirectoryRecord) => boolean
    } = {}
  ): CommunityDirectoryPage {
    const limit = Math.min(100, Math.max(1, input.limit ?? 100))
    const now = input.now ?? new Date()
    const listed = Array.from(this.committedRecords.values())
      .filter((entry) => isPubliclyCurrent(entry, now.getTime()))
      .filter((entry) => input.include?.(entry) ?? true)
      .sort((left, right) => left.webId.localeCompare(right.webId))
    const start = input.cursor ? listed.findIndex((entry) => entry.webId > input.cursor!) : 0
    const offset = start < 0 ? listed.length : start
    const selected = listed.slice(offset, offset + limit)
    const members = selected.map(toPublicDirectoryRecord)
    const nextCursor =
      offset + limit < listed.length ? (selected[selected.length - 1]?.webId ?? null) : null
    const generatedAt = now.toISOString()
    const publicPayload = { version: 1 as const, members, nextCursor }
    const digest = createHash('sha256').update(JSON.stringify(publicPayload)).digest('hex')
    return {
      ...publicPayload,
      generatedAt,
      etag: `W/"${digest}"`,
    }
  }

  getByWebId(webId: string): CommunityDirectoryRecord | null {
    return this.records.get(webId) ?? null
  }

  getCommittedByWebId(webId: string): CommunityDirectoryRecord | null {
    return this.committedRecords.get(webId) ?? null
  }

  getDurableByWebId(webId: string): CommunityDirectoryRecord | null {
    return this.durableRecords.get(webId) ?? null
  }
}

function toPublicDirectoryRecord(
  record: CommunityDirectoryRecord
): CommunityDirectoryPublicRecord {
  return {
    webId: record.webId,
    ...(record.displayName ? { displayName: record.displayName } : {}),
    ...(record.avatarUrl ? { avatarUrl: record.avatarUrl } : {}),
    ...(record.publicInterests?.length ? { publicInterests: [...record.publicInterests] } : {}),
  }
}

function isPubliclyCurrent(record: CommunityDirectoryRecord, nowMs: number): boolean {
  return (
    record.listed &&
    !record.suppressedAt &&
    typeof record.publicationRevision === 'number' &&
    Boolean(record.manifestExpiresAt) &&
    Date.parse(record.manifestExpiresAt!) > nowMs
  )
}

function isBoundedCurrentManifest(
  manifest: CommunityDirectoryProjectionInput['manifest'],
  nowMs: number
): boolean {
  if (!manifest) return false
  const publishedAt = Date.parse(manifest.publishedAt)
  const expiresAt = Date.parse(manifest.expiresAt)
  return (
    Number.isFinite(publishedAt) &&
    Number.isFinite(expiresAt) &&
    publishedAt <= nowMs + MAX_MANIFEST_CLOCK_SKEW_MS &&
    expiresAt > nowMs &&
    expiresAt - publishedAt <= MAX_MANIFEST_TTL_MS
  )
}
