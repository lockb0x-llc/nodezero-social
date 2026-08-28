export type PodArchiveResourceKind = 'container' | 'resource' | 'acl' | 'acp' | 'failed'
export type PodArchiveResourceStatus = 'exported' | 'failed' | 'skipped'

export interface PodArchiveResource {
  sourceUrl: string
  archivePath: string
  mediaType: string | null
  etag: string | null
  size: number
  kind: PodArchiveResourceKind
  status: PodArchiveResourceStatus
  error?: string
  bytes?: Uint8Array
}

export interface PodArchiveManifest {
  format: 'nodezero-solid-pod'
  formatVersion: 1
  podUrl: string
  exportedAt: string
  limits: Required<PodArchiveLimits>
  resources: Array<Omit<PodArchiveResource, 'bytes'>>
  warnings: string[]
}

export interface PodArchiveLimits {
  maxDepth?: number
  maxResources?: number
  maxResourceBytes?: number
  maxTotalBytes?: number
  concurrency?: number
}

export interface PodArchiveEntry extends PodArchiveResource {
  bytes: Uint8Array
}

export interface PodArchiveProgress {
  completed: number
  discovered: number
  totalBytes: number
  url: string
  status: PodArchiveResourceStatus
}

export interface PodArchiveExportResult {
  manifest: PodArchiveManifest
  entries: PodArchiveEntry[]
}

export type PodArchiveRestoreConflictPolicy =
  | 'fail'
  | 'skip'
  | 'overwrite'
  | 'overwrite-if-unchanged'

export interface PodArchiveRestoreOptions {
  conflictPolicy?: PodArchiveRestoreConflictPolicy
  applyControlResources?: boolean
  dryRun?: boolean
  signal?: AbortSignal
  onProgress?: (progress: PodArchiveProgress) => void
}

export type PodArchiveRestoreAction = 'create' | 'update' | 'skip' | 'conflict' | 'failed'

export interface PodArchiveRestoreItem {
  archivePath: string
  targetUrl: string
  kind: PodArchiveResourceKind
  action: PodArchiveRestoreAction
  status: 'planned' | 'applied' | 'failed'
  error?: string
}

export interface PodArchiveRestoreReport {
  targetPodUrl: string
  dryRun: boolean
  items: PodArchiveRestoreItem[]
  warnings: string[]
}