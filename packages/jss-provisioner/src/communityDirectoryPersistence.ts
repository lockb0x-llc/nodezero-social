import { createHash, randomUUID } from 'node:crypto'
import type { CommunityDirectoryRecord } from './communityDirectory.js'

const DIRECTORY_PARTITION = 'nz-community-directory'
const MAX_DIRECTORY_RECORDS = 10_000
const MAX_TABLE_PAGES = 100
const MAX_WRITE_ATTEMPTS = 5
const TABLE_REQUEST_TIMEOUT_MS = 5_000

export interface CommunityDirectoryPersistence {
  loadRecords(): Promise<CommunityDirectoryRecord[]>
  loadRecord(webId: string): Promise<CommunityDirectoryRecord | null>
  upsertRecord(record: CommunityDirectoryRecord): Promise<void>
  probe(): Promise<void>
}

export class AzureTableCommunityDirectoryPersistence implements CommunityDirectoryPersistence {
  private readonly tableUrl: string
  private readonly sasQuery: string

  constructor(
    sasUrl: string,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch
  ) {
    const parsed = new URL(sasUrl)
    if (parsed.protocol !== 'https:' || !parsed.searchParams.has('sig')) {
      throw new Error('JSS_COMMUNITY_DIRECTORY_TABLE_SAS_URL must be an HTTPS table SAS URL.')
    }
    const permissions = parsed.searchParams.get('sp') ?? ''
    for (const requiredPermission of ['r', 'a', 'u', 'd']) {
      if (!permissions.includes(requiredPermission)) {
        throw new Error(
          'JSS_COMMUNITY_DIRECTORY_TABLE_SAS_URL requires read, add, update, and delete permissions.'
        )
      }
    }
    this.tableUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
    this.sasQuery = parsed.search.slice(1)
  }

  async loadRecords(): Promise<CommunityDirectoryRecord[]> {
    const filter = encodeURIComponent(`PartitionKey eq '${DIRECTORY_PARTITION}'`)
    const records: CommunityDirectoryRecord[] = []
    let nextPartitionKey: string | null = null
    let nextRowKey: string | null = null
    const seenContinuations = new Set<string>()
    let pageCount = 0
    do {
      pageCount += 1
      if (pageCount > MAX_TABLE_PAGES) {
        throw new Error('Community Directory table scan exceeded its page limit.')
      }
      const continuation: string = [
        ...(nextPartitionKey ? [`NextPartitionKey=${encodeURIComponent(nextPartitionKey)}`] : []),
        ...(nextRowKey ? [`NextRowKey=${encodeURIComponent(nextRowKey)}`] : []),
      ].join('&')
      const response: Response = await this.fetchWithTimeout(
        `${this.tableUrl}?$filter=${filter}${continuation ? `&${continuation}` : ''}&${this.sasQuery}`,
        { headers: tableHeaders() }
      )
      if (!response.ok) {
        throw new Error(`Community Directory table read failed: HTTP ${response.status}`)
      }
      const payload = (await response.json()) as { value?: unknown }
      if (Array.isArray(payload.value)) {
        records.push(...payload.value.flatMap(parseRecordEntity))
        if (records.length > MAX_DIRECTORY_RECORDS) {
          throw new Error('Community Directory table scan exceeded its record limit.')
        }
      }
      nextPartitionKey = response.headers.get('x-ms-continuation-nextpartitionkey')
      nextRowKey = response.headers.get('x-ms-continuation-nextrowkey')
      const continuationKey = `${nextPartitionKey ?? ''}\0${nextRowKey ?? ''}`
      if ((nextPartitionKey || nextRowKey) && seenContinuations.has(continuationKey)) {
        throw new Error('Community Directory table returned a repeated continuation token.')
      }
      if (nextPartitionKey || nextRowKey) seenContinuations.add(continuationKey)
    } while (nextPartitionKey || nextRowKey)
    return records
  }

  async upsertRecord(record: CommunityDirectoryRecord): Promise<void> {
    const sanitized = sanitizeCommunityDirectoryRecord(record)
    if (!sanitized) {
      throw new Error('Community Directory record is invalid and cannot be persisted.')
    }
    const rowKey = createHash('sha256').update(record.webId).digest('hex')
    const entityUrl = `${this.tableUrl}(PartitionKey='${DIRECTORY_PARTITION}',RowKey='${rowKey}')?${this.sasQuery}`
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      const current = await this.readVersionedRecord(entityUrl)
      if (current && !shouldReplaceDirectoryRecord(current.record, sanitized)) return
      const response = await this.fetchWithTimeout(current ? entityUrl : this.tableRequestUrl(), {
        method: current ? 'PUT' : 'POST',
        headers: {
          ...tableHeaders(),
          'content-type': 'application/json',
          ...(current ? { 'if-match': current.etag } : {}),
          ...(!current ? { prefer: 'return-no-content' } : {}),
        },
        body: JSON.stringify({
          PartitionKey: DIRECTORY_PARTITION,
          RowKey: rowKey,
          recordJson: JSON.stringify(sanitized),
        }),
      })
      if (response.ok) return
      if (response.status !== 409 && response.status !== 412) {
        throw new Error(`Community Directory table write failed: HTTP ${response.status}`)
      }
    }
    throw new Error('Community Directory table write exceeded its conflict retry limit.')
  }

  async probe(): Promise<void> {
    const rowKey = `readiness-${randomUUID().replace(/-/g, '')}`
    const entityUrl = this.entityUrl(rowKey)
    let created = false
    let probeError: Error | null = null
    let cleanupError: Error | null = null
    try {
      const createResponse = await this.fetchWithTimeout(this.tableRequestUrl(), {
        method: 'POST',
        headers: {
          ...tableHeaders(),
          'content-type': 'application/json',
          prefer: 'return-no-content',
        },
        body: JSON.stringify({
          PartitionKey: DIRECTORY_PARTITION,
          RowKey: rowKey,
          recordJson: JSON.stringify({ readinessProbe: true }),
        }),
      })
      if (!createResponse.ok) {
        throw new Error(
          `Community Directory table readiness create failed: HTTP ${createResponse.status}`
        )
      }
      created = true
      const readResponse = await this.fetchWithTimeout(entityUrl, { headers: tableHeaders() })
      if (!readResponse.ok) {
        throw new Error(
          `Community Directory table readiness read failed: HTTP ${readResponse.status}`
        )
      }
    } catch (error) {
      probeError = error instanceof Error ? error : new Error(String(error))
    } finally {
      if (created) {
        const deleteResponse = await this.fetchWithTimeout(entityUrl, {
          method: 'DELETE',
          headers: { ...tableHeaders(), 'if-match': '*' },
        })
        if (!deleteResponse.ok && deleteResponse.status !== 404) {
          cleanupError = new Error(
            `Community Directory table readiness cleanup failed: HTTP ${deleteResponse.status}`
          )
        }
      }
    }
    if (probeError) throw probeError
    if (cleanupError) throw cleanupError
  }

  async loadRecord(webId: string): Promise<CommunityDirectoryRecord | null> {
    const rowKey = createHash('sha256').update(webId).digest('hex')
    return (await this.readVersionedRecord(this.entityUrl(rowKey)))?.record ?? null
  }

  private entityUrl(rowKey: string): string {
    return `${this.tableUrl}(PartitionKey='${DIRECTORY_PARTITION}',RowKey='${rowKey}')?${this.sasQuery}`
  }

  private tableRequestUrl(): string {
    return `${this.tableUrl}?${this.sasQuery}`
  }

  private async readVersionedRecord(entityUrl: string): Promise<{
    record: CommunityDirectoryRecord
    etag: string
  } | null> {
    const response = await this.fetchWithTimeout(entityUrl, { headers: tableHeaders() })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Community Directory table row read failed: HTTP ${response.status}`)
    }
    const entity = (await response.json()) as Record<string, unknown>
    const records = parseRecordEntity(entity)
    const etag =
      response.headers.get('etag') ??
      (typeof entity['odata.etag'] === 'string' ? entity['odata.etag'] : null)
    if (records.length !== 1 || !etag) {
      throw new Error('Community Directory table row is malformed or missing an ETag.')
    }
    const [record] = records
    if (!record) throw new Error('Community Directory table row is missing its record.')
    return { record, etag }
  }

  private async fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TABLE_REQUEST_TIMEOUT_MS)
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }
}

export function shouldReplaceDirectoryRecord(
  current: CommunityDirectoryRecord,
  incoming: CommunityDirectoryRecord
): boolean {
  const currentRevision = current.publicationRevision
  const incomingRevision = incoming.publicationRevision
  const currentSuppressionRevision = current.suppressionRevision
  const incomingSuppressionRevision = incoming.suppressionRevision
  if (typeof incomingSuppressionRevision === 'number') {
    if (typeof currentRevision === 'number' && incomingSuppressionRevision < currentRevision) {
      return false
    }
    if (
      typeof currentSuppressionRevision !== 'number' ||
      incomingSuppressionRevision > currentSuppressionRevision
    ) {
      return true
    }
  }
  if (
    current.suppressedAt &&
    (currentSuppressionRevision ?? 0) >= (incomingRevision ?? 0) &&
    !incoming.suppressedAt
  ) {
    return false
  }
  if (typeof incomingRevision === 'number') {
    if (typeof currentRevision !== 'number') return true
    if (incomingRevision < currentRevision) return false
    if (incomingRevision > currentRevision) return true
  } else if (typeof currentRevision === 'number') {
    return false
  }
  if (current.listed && !incoming.listed) return true
  if (!current.listed && incoming.listed) {
    if (current.suppressedAt) return false
    const currentPublication = Date.parse(current.publicationUpdatedAt ?? '')
    const incomingPublication = Date.parse(incoming.publicationUpdatedAt ?? '')
    if (
      Number.isFinite(currentPublication) &&
      Number.isFinite(incomingPublication) &&
      incomingPublication < currentPublication
    ) {
      return false
    }
    if (incoming.manifestExpiresAt) return true
  }
  const currentConsent = Date.parse(current.publicationUpdatedAt ?? current.updatedAt)
  const incomingConsent = Date.parse(incoming.publicationUpdatedAt ?? incoming.updatedAt)
  if (incomingConsent < currentConsent) return false
  if (incomingConsent > currentConsent) return true
  return Date.parse(incoming.updatedAt) > Date.parse(current.updatedAt)
}

function parseRecordEntity(entity: unknown): CommunityDirectoryRecord[] {
  if (!entity || typeof entity !== 'object') return []
  const recordJson = (entity as Record<string, unknown>).recordJson
  if (typeof recordJson !== 'string') return []
  try {
    const record = sanitizeCommunityDirectoryRecord(JSON.parse(recordJson))
    return record ? [record] : []
  } catch {
    return []
  }
}

function tableHeaders(): Record<string, string> {
  return {
    accept: 'application/json;odata=nometadata',
    'x-ms-version': '2023-11-03',
  }
}

export function sanitizeCommunityDirectoryRecord(value: unknown): CommunityDirectoryRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<CommunityDirectoryRecord>
  if (
    typeof record.webId !== 'string' ||
    typeof record.podUrl !== 'string' ||
    typeof record.issuer !== 'string' ||
    typeof record.listed !== 'boolean' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null
  }
  const sanitized: CommunityDirectoryRecord = {
    webId: record.webId,
    podUrl: record.podUrl,
    issuer: record.issuer,
    listed: record.listed,
    updatedAt: record.updatedAt,
  }
  for (const key of [
    'listedAt',
    'displayName',
    'avatarUrl',
    'manifestUrl',
    'manifestPublishedAt',
    'manifestExpiresAt',
    'publicationUpdatedAt',
    'suppressedAt',
    'sourceRevision',
    'removedAt',
  ] as const) {
    if (typeof record[key] === 'string') sanitized[key] = record[key]
  }
  const publicationRevision = record.publicationRevision
  if (Number.isSafeInteger(publicationRevision) && publicationRevision! >= 0) {
    sanitized.publicationRevision = publicationRevision!
  }
  const suppressionRevision = record.suppressionRevision
  if (Number.isSafeInteger(suppressionRevision) && suppressionRevision! >= 0) {
    sanitized.suppressionRevision = suppressionRevision!
  }
  return sanitized
}
