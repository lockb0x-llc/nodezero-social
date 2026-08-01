import {
  getContainedResourceUrlAll,
  getSolidDataset,
} from '@inrupt/solid-client'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface RelationshipInboxReaderOptions {
  maxResources?: number
  maxResourceBytes?: number
}

export interface RelationshipInboxResource {
  sourceUrl: string
  payload: unknown
}

export class RelationshipInboxReaderError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'RelationshipInboxReaderError'
  }
}

const DEFAULT_MAX_RESOURCES = 100
const DEFAULT_MAX_RESOURCE_BYTES = 64 * 1024
const ALLOWED_MEDIA_TYPES = new Set(['application/ld+json', 'application/json'])

export class RelationshipInboxReader {
  private readonly maxResources: number
  private readonly maxResourceBytes: number

  constructor(
    private readonly session: AuthenticatedSession,
    options: RelationshipInboxReaderOptions = {}
  ) {
    this.maxResources = options.maxResources ?? DEFAULT_MAX_RESOURCES
    this.maxResourceBytes = options.maxResourceBytes ?? DEFAULT_MAX_RESOURCE_BYTES
  }

  async listResourceUrls(podRoot: string): Promise<string[]> {
    const inboxUrl = relationshipInboxUrl(podRoot)
    const dataset = await getSolidDataset(inboxUrl, { fetch: this.session.fetch })
    const urls = getContainedResourceUrlAll(dataset)
      .filter((url) => isDirectInboxChild(inboxUrl, url))
      .sort((left, right) => left.localeCompare(right))
    if (urls.length > this.maxResources) {
      throw new RelationshipInboxReaderError(
        `Relationship inbox exceeds ${this.maxResources} resources.`,
        'inbox_resource_limit'
      )
    }
    return urls
  }

  async readResource(podRoot: string, sourceUrl: string): Promise<RelationshipInboxResource> {
    const inboxUrl = relationshipInboxUrl(podRoot)
    if (!isDirectInboxChild(inboxUrl, sourceUrl)) {
      throw new RelationshipInboxReaderError(
        'Relationship inbox resource must be a direct child of the owner inbox.',
        'inbox_resource_scope'
      )
    }
    const response = await this.session.fetch(sourceUrl, {
      headers: { Accept: 'application/ld+json, application/json' },
    })
    if (!response.ok) {
      throw new RelationshipInboxReaderError(
        `Unable to read relationship inbox resource: HTTP ${response.status}`,
        'inbox_resource_read_failed'
      )
    }
    const mediaType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (!mediaType || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
      throw new RelationshipInboxReaderError(
        'Relationship inbox resource has an unsupported media type.',
        'inbox_resource_media_type'
      )
    }
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > this.maxResourceBytes) {
      throw new RelationshipInboxReaderError(
        `Relationship inbox resource exceeds ${this.maxResourceBytes} bytes.`,
        'inbox_resource_too_large'
      )
    }
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > this.maxResourceBytes) {
      throw new RelationshipInboxReaderError(
        `Relationship inbox resource exceeds ${this.maxResourceBytes} bytes.`,
        'inbox_resource_too_large'
      )
    }
    try {
      return { sourceUrl, payload: JSON.parse(text) }
    } catch {
      throw new RelationshipInboxReaderError(
        'Relationship inbox resource must contain valid JSON.',
        'inbox_resource_invalid_json'
      )
    }
  }

  async removeResource(podRoot: string, sourceUrl: string): Promise<void> {
    const inboxUrl = relationshipInboxUrl(podRoot)
    if (!isDirectInboxChild(inboxUrl, sourceUrl)) {
      throw new RelationshipInboxReaderError(
        'Relationship inbox resource must be a direct child of the owner inbox.',
        'inbox_resource_scope'
      )
    }
    const response = await this.session.fetch(sourceUrl, { method: 'DELETE' })
    if (response.status === 404) return
    if (!response.ok) {
      throw new RelationshipInboxReaderError(
        `Unable to remove relationship inbox resource: HTTP ${response.status}`,
        'inbox_resource_remove_failed'
      )
    }
  }
}

function relationshipInboxUrl(podRoot: string): string {
  return `${podRoot.replace(/\/$/, '')}/social/inbox/`
}

function isDirectInboxChild(inboxUrl: string, candidate: string): boolean {
  try {
    const inbox = new URL(inboxUrl)
    const child = new URL(candidate)
    if (child.origin !== inbox.origin || !child.pathname.startsWith(inbox.pathname)) return false
    const relativePath = child.pathname.slice(inbox.pathname.length)
    return relativePath.length > 0 && !relativePath.includes('/') && !child.hash
  } catch {
    return false
  }
}

export const RELATIONSHIP_INBOX_PATH = 'social/inbox/'
