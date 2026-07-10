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

export class CommunityDirectoryStore {
  private readonly records = new Map<string, CommunityDirectoryRecord>()

  seedRecord(input: { webId: string; podUrl: string; issuer: string }): CommunityDirectoryRecord {
    const now = new Date().toISOString()
    const existing = this.records.get(input.webId)
    if (existing) {
      existing.podUrl = input.podUrl
      existing.issuer = input.issuer
      existing.updatedAt = now
      this.records.set(input.webId, existing)
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
