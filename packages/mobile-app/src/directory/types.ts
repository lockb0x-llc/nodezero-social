export interface DirectoryRecord {
  webId: string
  displayName?: string
  avatarUrl?: string
  publicInterests?: string[]
  trustSignals?: {
    verified?: boolean
  }
}

export interface DirectoryEntry {
  webId: string
  displayName: string
  avatarUrl?: string
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
