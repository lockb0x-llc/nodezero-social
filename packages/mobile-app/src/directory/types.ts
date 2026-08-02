export interface DirectoryRecord {
  webId: string
  displayName?: string
  podUrl?: string
  issuer?: string
  listed?: boolean
  listedAt?: string
  updatedAt?: string
  publicInterests?: string[]
  capabilities?: string[]
  inboxUrl?: string
  manifestExpiresAt?: string
  sourceRevision?: string
  trustSignals?: {
    verified?: boolean
  }
}

export interface DirectoryEntry {
  webId: string
  displayName: string
  source: 'self' | 'connection' | 'directory'
  verified: boolean
  publicInterests: string[]
  recommendationReasons: DirectoryRecommendationReason[]
}

export type DirectoryRecommendationReason =
  | 'self'
  | 'accepted-relationship'
  | 'legacy-contact'
  | 'shared-public-interest'
  | 'public-directory'

export interface DirectoryPage {
  version: 1
  members: DirectoryRecord[]
  nextCursor: string | null
  etag: string | null
}
