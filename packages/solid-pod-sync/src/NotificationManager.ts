import {
  assertValidDigestManifest,
  assertValidNotificationEvent,
  assertValidNotificationPreferences,
  type DigestManifest,
  type NotificationEvent,
  type NotificationPreferences,
} from './contracts/NotificationContract.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

interface NotificationHistoryRecordBase {
  recordedAt: string
}

export type NotificationHistoryRecord =
  | (NotificationHistoryRecordBase & { kind: 'event'; event: NotificationEvent })
  | (NotificationHistoryRecordBase & { kind: 'digest'; digest: DigestManifest })

interface NotificationHistoryDocument {
  '@context': string
  '@type': 'NotificationHistory'
  date: string
  records: NotificationHistoryRecord[]
}

export interface NotificationManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
  }
}

export interface NotificationPreferencesPatch {
  channels?: Partial<NotificationPreferences['channels']>
  digest?: Partial<NotificationPreferences['digest']>
  categories?: Partial<NotificationPreferences['categories']>
  locale?: NotificationPreferences['locale']
}

function nowIso(): string {
  return new Date().toISOString()
}

function dateKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10)
}

function preferencesUrl(podRoot: string): string {
  const base = podRoot.replace(/\/$/, '')
  return `${base}/backpack/notifications/preferences.json`
}

function digestStateUrl(podRoot: string): string {
  const base = podRoot.replace(/\/$/, '')
  return `${base}/backpack/notifications/digest-state.json`
}

function historyUrl(podRoot: string, date: string): string {
  const base = podRoot.replace(/\/$/, '')
  return `${base}/backpack/notifications/history/${date}.json`
}

function defaultNotificationPreferences(): NotificationPreferences {
  const updatedAt = nowIso()
  return {
    version: 1,
    channels: {
      email: true,
    },
    digest: {
      cadence: 'daily',
      timezone: 'UTC',
    },
    categories: {
      security: true,
      account: true,
      social: true,
      mentions: true,
      system: true,
      product: true,
    },
    updatedAt,
  }
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export class NotificationManager {
  constructor(
    private readonly session: AuthenticatedSession,
    private readonly options: NotificationManagerOptions = {}
  ) {}

  async getPreferences(podRoot: string): Promise<NotificationPreferences | null> {
    const url = preferencesUrl(podRoot)
    const response = await this.session.fetch(url, {
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to read notification preferences at ${url}: HTTP ${response.status}`)
    }

    const parsed = parseJson<NotificationPreferences>(await response.text())
    if (!parsed) {
      throw new Error(`Invalid JSON payload for notification preferences at ${url}`)
    }

    assertValidNotificationPreferences(parsed)
    return parsed
  }

  async setPreferences(
    podRoot: string,
    preferences: NotificationPreferences
  ): Promise<NotificationPreferences> {
    await this.ensurePodLayoutIfEnabled(podRoot)

    const payload: NotificationPreferences = {
      ...preferences,
      updatedAt: nowIso(),
    }
    assertValidNotificationPreferences(payload)

    const url = preferencesUrl(podRoot)
    await this.writeJson(url, payload)
    return payload
  }

  async upsertPreferences(
    podRoot: string,
    patch: NotificationPreferencesPatch
  ): Promise<NotificationPreferences> {
    const existing = (await this.getPreferences(podRoot)) ?? defaultNotificationPreferences()
    const digestQuietHours =
      patch.digest?.quietHours !== undefined
        ? patch.digest.quietHours
        : existing.digest.quietHours

    const locale = patch.locale !== undefined ? patch.locale : existing.locale

    const next: NotificationPreferences = {
      version: 1,
      channels: {
        ...existing.channels,
        ...(patch.channels ?? {}),
      },
      digest: {
        cadence: patch.digest?.cadence ?? existing.digest.cadence,
        timezone: patch.digest?.timezone ?? existing.digest.timezone,
        ...(digestQuietHours ? { quietHours: digestQuietHours } : {}),
      },
      categories: {
        ...existing.categories,
        ...(patch.categories ?? {}),
      },
      updatedAt: nowIso(),
    }

    if (locale !== undefined) {
      next.locale = locale
    }

    return this.setPreferences(podRoot, next)
  }

  async getDigestState(podRoot: string): Promise<Record<string, unknown> | null> {
    const url = digestStateUrl(podRoot)
    const response = await this.session.fetch(url, {
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to read digest state at ${url}: HTTP ${response.status}`)
    }

    return parseJson<Record<string, unknown>>(await response.text())
  }

  async setDigestState(podRoot: string, state: Record<string, unknown>): Promise<void> {
    await this.ensurePodLayoutIfEnabled(podRoot)

    const url = digestStateUrl(podRoot)
    await this.writeJson(url, {
      ...state,
      updatedAt: nowIso(),
    })
  }

  async listHistory(podRoot: string, date: string = dateKey(nowIso())): Promise<NotificationHistoryRecord[]> {
    const url = historyUrl(podRoot, date)
    const response = await this.session.fetch(url, {
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      if (response.status === 404) return []
      throw new Error(`Failed to read notification history at ${url}: HTTP ${response.status}`)
    }

    const parsed = parseJson<NotificationHistoryDocument>(await response.text())
    if (!parsed || !Array.isArray(parsed.records)) return []
    return parsed.records
  }

  async recordEvent(podRoot: string, event: NotificationEvent): Promise<void> {
    assertValidNotificationEvent(event)
    await this.appendHistoryRecord(podRoot, dateKey(event.occurredAt), {
      kind: 'event',
      event,
      recordedAt: nowIso(),
    })
  }

  async recordDigestManifest(podRoot: string, digest: DigestManifest): Promise<void> {
    assertValidDigestManifest(digest)
    await this.appendHistoryRecord(podRoot, dateKey(digest.renderedAt), {
      kind: 'digest',
      digest,
      recordedAt: nowIso(),
    })
  }

  private async appendHistoryRecord(
    podRoot: string,
    date: string,
    record: NotificationHistoryRecord
  ): Promise<void> {
    await this.ensurePodLayoutIfEnabled(podRoot)

    const url = historyUrl(podRoot, date)
    const current = await this.listHistory(podRoot, date)
    const next: NotificationHistoryDocument = {
      '@context': 'https://vocab.nodezero.social/notification-history/v1',
      '@type': 'NotificationHistory',
      date,
      records: [...current, record],
    }

    await this.writeJson(url, next)
  }

  private async writeJson(url: string, payload: unknown): Promise<void> {
    const response = await this.session.fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload, null, 2),
    })

    if (!response.ok) {
      throw new Error(`Failed to write notification resource at ${url}: HTTP ${response.status}`)
    }
  }

  private async ensurePodLayoutIfEnabled(podRoot: string): Promise<void> {
    if (!this.options.enablePodBootstrap) return

    const podLayoutManager =
      this.options.podLayoutManager ?? new PodLayoutManager({ fetch: this.session.fetch })

    await podLayoutManager.ensureDefaultLayoutAndPolicies(
      podRoot,
      this.options.policyMatrix ?? DEFAULT_POLICY_MATRIX
    )
  }
}
