interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface RelationshipInboxReaderOptions {
  maxResources?: number
  maxResourceBytes?: number
  maxContainerBytes?: number
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
const DEFAULT_MAX_CONTAINER_BYTES = 256 * 1024
const ALLOWED_MEDIA_TYPES = new Set(['application/ld+json', 'application/json'])

export class RelationshipInboxReader {
  private readonly maxResources: number
  private readonly maxResourceBytes: number
  private readonly maxContainerBytes: number

  constructor(
    private readonly session: AuthenticatedSession,
    options: RelationshipInboxReaderOptions = {}
  ) {
    this.maxResources = options.maxResources ?? DEFAULT_MAX_RESOURCES
    this.maxResourceBytes = options.maxResourceBytes ?? DEFAULT_MAX_RESOURCE_BYTES
    this.maxContainerBytes = options.maxContainerBytes ?? DEFAULT_MAX_CONTAINER_BYTES
  }

  async listResourceUrls(podRoot: string): Promise<string[]> {
    const inboxUrl = relationshipInboxUrl(podRoot)
    const response = await this.session.fetch(inboxUrl, {
      headers: { Accept: 'text/turtle, application/ld+json' },
    })
    if (!response.ok) {
      throw new RelationshipInboxReaderError(
        `Unable to read relationship inbox: HTTP ${response.status}`,
        'inbox_read_failed'
      )
    }
    return readContainedResourceBatch(
      response,
      inboxUrl,
      this.maxResources,
      this.maxContainerBytes
    )
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
    const text = await readBoundedText(response, this.maxResourceBytes, 'inbox_resource_too_large')
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

async function readBoundedText(
  response: Response,
  maxBytes: number,
  errorCode: string
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RelationshipInboxReaderError(
      `Relationship inbox response exceeds ${maxBytes} bytes.`,
      errorCode
    )
  }
  if (!response.body) return ''
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new RelationshipInboxReaderError(
        `Relationship inbox response exceeds ${maxBytes} bytes.`,
        errorCode
      )
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function readContainedResourceBatch(
  response: Response,
  inboxUrl: string,
  maxResources: number,
  maxBytes: number
): Promise<string[]> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes * 16) {
    throw new RelationshipInboxReaderError(
      'Relationship inbox representation is unreasonably large.',
      'inbox_container_too_large'
    )
  }
  if (!response.body) return []
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
  const decoder = new TextDecoder()
  const resources = new Set<string>()
  let pending = ''
  let parsedBytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parsedBytes += value.byteLength
    pending += decoder.decode(value, { stream: true })
    pending = collectContainedUrls(pending, inboxUrl, resources)
    if (resources.size >= maxResources || (parsedBytes > maxBytes && resources.size > 0)) {
      await reader.cancel()
      break
    }
    if (parsedBytes > maxBytes) {
      await reader.cancel()
      throw new RelationshipInboxReaderError(
        `Relationship inbox yielded no resources within ${maxBytes} bytes.`,
        'inbox_container_too_large'
      )
    }
  }
  pending += decoder.decode()
  collectContainedUrls(`${pending}\n`, inboxUrl, resources)
  return Array.from(resources).sort((left, right) => left.localeCompare(right)).slice(0, maxResources)
}

function collectContainedUrls(
  source: string,
  inboxUrl: string,
  resources: Set<string>
): string {
  const { statements, remainder } = splitTurtleStatements(source)
  for (const statement of statements) {
    const predicateMatch = /(?:ldp:contains|<http:\/\/www\.w3\.org\/ns\/ldp#contains>)\s+([\s\S]*)/.exec(statement)
    if (!predicateMatch) continue
    for (const iriMatch of (predicateMatch[1] ?? '').matchAll(/<([^>]+)>/g)) {
      const candidate = new URL(iriMatch[1] ?? '', inboxUrl).toString()
      if (isDirectInboxChild(inboxUrl, candidate)) resources.add(candidate)
    }
  }
  return remainder
}

function splitTurtleStatements(source: string): { statements: string[]; remainder: string } {
  const statements: string[] = []
  let start = 0
  let inIri = false
  let quote: '"' | "'" | null = null
  let escaped = false
  let inComment = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (inComment) {
      if (character === '\n' || character === '\r') inComment = false
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (inIri) {
      if (character === '>') inIri = false
      continue
    }
    if (character === '#') inComment = true
    else if (character === '<') inIri = true
    else if (character === '"' || character === "'") quote = character
    else if (character === '.') {
      statements.push(source.slice(start, index + 1))
      start = index + 1
    }
  }
  return { statements, remainder: source.slice(start) }
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
