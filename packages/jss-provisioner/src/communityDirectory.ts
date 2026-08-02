import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
  consentUpdatedAt?: string
  sourceRevision?: string
  removedAt?: string
}

export interface CommunityDirectoryProjectionInput {
  webId: string
  podUrl: string
  issuer: string
  publicListing: boolean
  publicIndexing: boolean
  consentUpdatedAt: string
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
  members: CommunityDirectoryRecord[]
}

export interface CommunityDirectoryPage {
  version: 1
  generatedAt: string
  members: CommunityDirectoryRecord[]
  nextCursor: string | null
  etag: string
}

interface PersistedCommunityDirectory {
  version: 1
  records: CommunityDirectoryRecord[]
}

export class CommunityDirectoryStore {
  private readonly records = new Map<string, CommunityDirectoryRecord>()
  private readonly persistenceFilePath: string

  constructor(options?: { persistenceFilePath?: string }) {
    this.persistenceFilePath =
      options?.persistenceFilePath?.trim() ||
      join(process.cwd(), '.data', 'community-directory.json')
    this.loadFromDisk()
  }

  private loadFromDisk(): void {
    try {
      const raw = readFileSync(this.persistenceFilePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedCommunityDirectory>
      const records = Array.isArray(parsed.records) ? parsed.records : []
      for (const record of records) {
        if (
          record &&
          typeof record.webId === 'string' &&
          typeof record.podUrl === 'string' &&
          typeof record.issuer === 'string' &&
          typeof record.listed === 'boolean' &&
          typeof record.updatedAt === 'string'
        ) {
          this.records.set(record.webId, { ...record })
        }
      }
    } catch {
      // Missing or malformed file should not block provisioning startup.
    }
  }

  private persistToDisk(): void {
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
  }

  seedRecord(input: { webId: string; podUrl: string; issuer: string }): CommunityDirectoryRecord {
    const now = new Date().toISOString()
    const existing = this.records.get(input.webId)
    if (existing) {
      existing.podUrl = input.podUrl
      existing.issuer = input.issuer
      existing.updatedAt = now
      this.records.set(input.webId, existing)
      this.persistToDisk()
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
    this.persistToDisk()
    return record
  }

  setListing(webId: string, listed: boolean): CommunityDirectoryRecord | null {
    const record = this.records.get(webId)
    if (!record) return null

    const now = new Date().toISOString()
    const wasListed = record.listed
    record.listed = listed
    record.updatedAt = now
    if (listed) {
      record.listedAt = record.listedAt ?? now
      delete record.removedAt
    } else {
      delete record.listedAt
      if (wasListed) record.removedAt = now
    }

    this.records.set(webId, record)
    this.persistToDisk()
    return record
  }

  refreshProjection(input: CommunityDirectoryProjectionInput): CommunityDirectoryRecord {
    const now = input.now ?? new Date()
    const existing = this.records.get(input.webId)
    const manifestIsCurrent = Boolean(
      input.manifest && Date.parse(input.manifest.expiresAt) > now.getTime()
    )
    const listed = input.publicListing && input.publicIndexing && manifestIsCurrent
    const record: CommunityDirectoryRecord = {
      webId: input.webId,
      podUrl: input.podUrl,
      issuer: input.issuer,
      listed,
      updatedAt: now.toISOString(),
      consentUpdatedAt: input.consentUpdatedAt,
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
      if (input.manifest.publicInterests) {
        record.publicInterests = [...input.manifest.publicInterests]
      }
      if (input.manifest.capabilities) record.capabilities = [...input.manifest.capabilities]
      if (input.manifest.inboxUrl) record.inboxUrl = input.manifest.inboxUrl
    } else {
      delete record.listedAt
      if (existing?.listed) record.removedAt = now.toISOString()
      else if (existing?.removedAt) record.removedAt = existing.removedAt
    }

    this.records.set(input.webId, record)
    this.persistToDisk()
    return record
  }

  buildPublicIndex(): CommunityDirectoryIndex {
    const members = Array.from(this.records.values())
      .filter((entry) => entry.listed)
      .sort((a, b) => a.webId.localeCompare(b.webId))

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      members,
    }
  }

  buildPublicPage(input: {
    cursor?: string
    limit?: number
    now?: Date
  } = {}): CommunityDirectoryPage {
    const limit = Math.min(100, Math.max(1, input.limit ?? 100))
    const listed = Array.from(this.records.values())
      .filter((entry) => entry.listed)
      .sort((left, right) => left.webId.localeCompare(right.webId))
    const start = input.cursor
      ? listed.findIndex((entry) => entry.webId > input.cursor!)
      : 0
    const offset = start < 0 ? listed.length : start
    const members = listed.slice(offset, offset + limit)
    const nextCursor = offset + limit < listed.length
      ? members[members.length - 1]?.webId ?? null
      : null
    const generatedAt = (input.now ?? new Date()).toISOString()
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
}
