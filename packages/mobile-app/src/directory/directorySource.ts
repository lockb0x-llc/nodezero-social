import Constants from 'expo-constants'
import type { DirectoryRecord } from './types'
import { deriveNameFromWebId } from './webIdName'

export { deriveNameFromWebId } from './webIdName'

export function isLikelyWebId(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.pathname.includes('/profile/card')
  } catch {
    return false
  }
}

export function resolveDirectoryEndpoint(): string {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  const custom = appExtra?.nodeZeroDirectoryUrl?.trim()
  if (custom) return custom

  const issuer = (appExtra?.nodeZeroIssuerUrl ?? '').trim().replace(/\/+$/, '')
  if (!issuer) return ''

  return `${issuer}/public/nodezero-pod-holders.json`
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
            trustSignals: { verified },
          }
        }
      }

      return null
    })

  return mapped.filter((entry): entry is DirectoryRecord => Boolean(entry && isLikelyWebId(entry.webId)))
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
