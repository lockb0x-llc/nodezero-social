import type { DirectoryPage, DirectoryRecord } from './types'

export function isLikelyWebId(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.pathname.includes('/profile/card')
  } catch {
    return false
  }
}

export function resolveDirectoryEndpointFromExtra(appExtra: Record<string, string> | undefined): string {
  const custom = appExtra?.nodeZeroDirectoryUrl?.trim()
  if (custom) return custom

  const provisioner = (appExtra?.jssProvisionerUrl ?? '').trim().replace(/\/+$/, '')
  if (!provisioner) return ''

  return `${provisioner}/v1/community-directory/index`
}

function parseFromArray(payload: unknown[]): DirectoryRecord[] {
  const mapped: Array<DirectoryRecord | null> = payload.map((entry) => {
    if (typeof entry === 'string') {
      return { webId: entry }
    }

    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      if (typeof record.webId === 'string') {
        const verified =
          record.trustSignals &&
          typeof record.trustSignals === 'object' &&
          typeof (record.trustSignals as Record<string, unknown>).verified === 'boolean'
            ? Boolean((record.trustSignals as Record<string, unknown>).verified)
            : undefined

        return {
          webId: record.webId,
          displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
          podUrl: typeof record.podUrl === 'string' ? record.podUrl : undefined,
          issuer: typeof record.issuer === 'string' ? record.issuer : undefined,
          listed: typeof record.listed === 'boolean' ? record.listed : undefined,
          listedAt: typeof record.listedAt === 'string' ? record.listedAt : undefined,
          updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
          publicInterests: Array.isArray(record.publicInterests)
            ? record.publicInterests.filter((value): value is string => typeof value === 'string')
            : undefined,
          capabilities: Array.isArray(record.capabilities)
            ? record.capabilities.filter((value): value is string => typeof value === 'string')
            : undefined,
          inboxUrl: typeof record.inboxUrl === 'string' ? record.inboxUrl : undefined,
          manifestExpiresAt:
            typeof record.manifestExpiresAt === 'string' ? record.manifestExpiresAt : undefined,
          sourceRevision:
            typeof record.sourceRevision === 'string' ? record.sourceRevision : undefined,
          trustSignals: { verified },
        }
      }
    }

    return null
  })

  return mapped.filter((entry): entry is DirectoryRecord => Boolean(entry && isLikelyWebId(entry.webId)))
}

export function parseDirectoryPage(payload: unknown, etag: string | null = null): DirectoryPage {
  if (!payload || typeof payload !== 'object') {
    return { version: 1, members: [], nextCursor: null, etag }
  }
  const record = payload as Record<string, unknown>
  return {
    version: 1,
    members: parseDirectoryRecords(payload),
    nextCursor: typeof record.nextCursor === 'string' ? record.nextCursor : null,
    etag,
  }
}

export function buildDirectoryPageUrl(
  endpoint: string,
  input: { cursor?: string; limit?: number } = {}
): string {
  const url = new URL(endpoint)
  url.searchParams.set('limit', String(Math.min(100, Math.max(1, input.limit ?? 50))))
  if (input.cursor) url.searchParams.set('cursor', input.cursor)
  return url.toString()
}

export function parseDirectoryRecords(payload: unknown): DirectoryRecord[] {
  if (Array.isArray(payload)) {
    return parseFromArray(payload)
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.members)) {
      return parseFromArray(record.members)
    }
  }

  return []
}
