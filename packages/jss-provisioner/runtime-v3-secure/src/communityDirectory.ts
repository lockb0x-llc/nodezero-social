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
}

export interface CommunityDirectoryIndex {
  version: 1
  generatedAt: string
  members: CommunityDirectoryRecord[]
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
    record.listed = listed
    record.updatedAt = now
    if (listed) {
      record.listedAt = record.listedAt ?? now
    } else {
      delete record.listedAt
    }

    this.records.set(webId, record)
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

  getByWebId(webId: string): CommunityDirectoryRecord | null {
    return this.records.get(webId) ?? null
  }
}
