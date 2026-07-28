export interface TrustCircleDocument {
  version: 1
  members: string[]
  updatedAt: string
}

export interface TrustCircleStoreOptions {
  fetch?: typeof globalThis.fetch
}

export interface TrustCircleLocalAdapter {
  readLocal(ownerWebId: string): Promise<string[]>
  writeLocal(ownerWebId: string, members: string[]): Promise<void>
}

export interface TrustCircleStore {
  list(ownerWebId: string, options?: TrustCircleStoreOptions): Promise<string[]>
  add(ownerWebId: string, targetWebId: string, options?: TrustCircleStoreOptions): Promise<string[]>
  remove(ownerWebId: string, targetWebId: string, options?: TrustCircleStoreOptions): Promise<string[]>
  has(ownerWebId: string, targetWebId: string, options?: TrustCircleStoreOptions): Promise<boolean>
}

interface PodTrustCircleState {
  members: string[]
  etag: string | null
  exists: boolean
}

function normalizeMembers(members: string[]): string[] {
  return Array.from(
    new Set(
      members
        .map((member) => member.trim())
        .filter((member) => member.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b))
}

export function deriveTrustCircleDocumentUrl(ownerWebId: string): string {
  const podRoot = `${ownerWebId.split('/profile/')[0]}/`
  return `${podRoot}backpack/preferences/trust-circle.json`
}

export function serializeTrustCircleDocument(members: string[], now = new Date()): string {
  const payload: TrustCircleDocument = {
    version: 1,
    members: normalizeMembers(members),
    updatedAt: now.toISOString(),
  }

  return JSON.stringify(payload, null, 2)
}

export function parseTrustCircleDocument(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return normalizeMembers(parsed.filter((entry): entry is string => typeof entry === 'string'))
    }

    if (parsed && typeof parsed === 'object') {
      const maybe = parsed as { members?: unknown }
      if (Array.isArray(maybe.members)) {
        return normalizeMembers(maybe.members.filter((entry): entry is string => typeof entry === 'string'))
      }
    }
  } catch {
    // Ignore malformed payloads and treat as empty.
  }

  return []
}

export function createTrustCircleStore(local: TrustCircleLocalAdapter): TrustCircleStore {
  async function readPodState(
    ownerWebId: string,
    fetcher: typeof globalThis.fetch
  ): Promise<PodTrustCircleState | null> {
    const docUrl = deriveTrustCircleDocumentUrl(ownerWebId)
    const response = await fetcher(docUrl, {
      headers: { Accept: 'application/json' },
    })

    if (response.ok) {
      const etag = response.headers.get('etag')
      const members = parseTrustCircleDocument(await response.text())
      return { members, etag, exists: true }
    }

    if (response.status === 404) {
      return { members: [], etag: null, exists: false }
    }

    return null
  }

  async function writePodState(
    ownerWebId: string,
    members: string[],
    fetcher: typeof globalThis.fetch,
    etag: string | null
  ): Promise<'ok' | 'conflict' | 'error'> {
    const docUrl = deriveTrustCircleDocumentUrl(ownerWebId)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (etag) {
      headers['If-Match'] = etag
    }

    try {
      const response = await fetcher(docUrl, {
        method: 'PUT',
        headers,
        body: serializeTrustCircleDocument(members),
      })

      if (response.ok) return 'ok'
      if (response.status === 409 || response.status === 412) return 'conflict'
      return 'error'
    } catch {
      return 'error'
    }
  }

  async function list(ownerWebId: string, options: TrustCircleStoreOptions = {}): Promise<string[]> {
    const localMembers = normalizeMembers(await local.readLocal(ownerWebId))
    const fetcher = options.fetch
    if (!fetcher) return localMembers

    try {
      const podState = await readPodState(ownerWebId, fetcher)
      if (!podState) return localMembers

      if (podState.exists) {
        const podMembers = podState.members
        await local.writeLocal(ownerWebId, podMembers)
        return podMembers
      }

      if (!podState.exists) {
        if (localMembers.length > 0) {
          await writePodState(ownerWebId, localMembers, fetcher, null)
        }
        return localMembers
      }
    } catch {
      return localMembers
    }

    return localMembers
  }

  async function writePod(ownerWebId: string, members: string[], options: TrustCircleStoreOptions = {}): Promise<void> {
    const fetcher = options.fetch
    if (!fetcher) return

    try {
      const podState = await readPodState(ownerWebId, fetcher)
      if (!podState) return

      const firstWrite = await writePodState(ownerWebId, members, fetcher, podState.etag)
      if (firstWrite !== 'conflict') return

      const latestState = await readPodState(ownerWebId, fetcher)
      if (!latestState) return
      const mergedMembers = normalizeMembers([...latestState.members, ...members])
      await writePodState(ownerWebId, mergedMembers, fetcher, latestState.etag)
      await local.writeLocal(ownerWebId, mergedMembers)
    } catch {
      // Keep local state when Pod write is unavailable.
    }
  }

  async function add(ownerWebId: string, targetWebId: string, options: TrustCircleStoreOptions = {}): Promise<string[]> {
    const members = await list(ownerWebId, options)
    const updated = normalizeMembers([...members, targetWebId])
    await local.writeLocal(ownerWebId, updated)
    await writePod(ownerWebId, updated, options)
    return updated
  }

  async function remove(ownerWebId: string, targetWebId: string, options: TrustCircleStoreOptions = {}): Promise<string[]> {
    const members = await list(ownerWebId, options)
    const updated = normalizeMembers(members.filter((member) => member !== targetWebId))
    await local.writeLocal(ownerWebId, updated)
    await writePod(ownerWebId, updated, options)
    return updated
  }

  async function has(ownerWebId: string, targetWebId: string, options: TrustCircleStoreOptions = {}): Promise<boolean> {
    const members = await list(ownerWebId, options)
    return members.includes(targetWebId)
  }

  return {
    list,
    add,
    remove,
    has,
  }
}
