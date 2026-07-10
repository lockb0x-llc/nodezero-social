export interface DirectoryRecord {
  webId: string
  displayName?: string
  podUrl?: string
  issuer?: string
  listed?: boolean
  listedAt?: string
  updatedAt?: string
  trustSignals?: {
    verified?: boolean
  }
}

export interface DirectoryEntry {
  webId: string
  displayName: string
  source: 'self' | 'connection' | 'directory'
  verified: boolean
}
