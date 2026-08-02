import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'

export const PUBLIC_RESOURCE_CONTENT_TYPES = [
  'text/turtle',
  'application/ld+json',
  'application/activity+json',
  'application/json',
  'application/jrd+json',
] as const

export interface PublicResourceFetcherOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  userAgent?: string
  resolveHost?: typeof lookup
  requestOnce?: PublicResourceRequest
}

export interface PublicResourceDeliveryOptions {
  timeoutMs?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
  maxRedirects?: number
  userAgent?: string
  resolveHost?: typeof lookup
  requestOnce?: PublicResourcePostRequest
}

export interface PublicResourceResponse {
  finalUrl: string
  status: number
  contentType: string
  body: Buffer
  etag?: string
  lastModified?: string
  link?: string
}

export interface PublicResourceDeliveryResponse {
  finalUrl: string
  status: number
  location?: string
}

export interface PublicResourceRequestInput {
  url: URL
  addresses: Array<{ address: string; family: number }>
  timeoutMs: number
  maxBytes: number
  userAgent: string
}

export interface PublicResourceRequestResult {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

export type PublicResourceRequest = (
  input: PublicResourceRequestInput
) => Promise<PublicResourceRequestResult>

export interface PublicResourcePostRequestInput {
  url: URL
  addresses: Array<{ address: string; family: number }>
  timeoutMs: number
  maxResponseBytes: number
  userAgent: string
  contentType: string
  body: Buffer
}

export type PublicResourcePostRequest = (
  input: PublicResourcePostRequestInput
) => Promise<PublicResourceRequestResult>

export class PublicResourceFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message)
    this.name = 'PublicResourceFetchError'
  }
}

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_BYTES = 512 * 1024
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_USER_AGENT = 'NodeZero-PublicResourceFetcher/1.0'

export async function fetchPublicResource(
  rawUrl: string,
  options: PublicResourceFetcherOptions = {}
): Promise<PublicResourceResponse> {
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES)
  const maxRedirects = nonNegativeInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS)
  const resolveHost = options.resolveHost ?? lookup
  const requestOnce = options.requestOnce ?? requestPinnedHttps
  const userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT

  let currentUrl = parsePublicUrl(rawUrl)
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const addresses = await resolvePublicAddresses(currentUrl.hostname, resolveHost)
    const response = await requestOnce({
      url: currentUrl,
      addresses,
      timeoutMs,
      maxBytes,
      userAgent,
    })

    if (response.status >= 300 && response.status < 400) {
      const location = firstHeader(response.headers.location)
      if (!location) {
        throw new PublicResourceFetchError(
          'Public resource redirect is missing a location.',
          502,
          'redirect_missing_location'
        )
      }
      if (redirectCount === maxRedirects) {
        throw new PublicResourceFetchError(
          'Public resource has too many redirects.',
          502,
          'too_many_redirects'
        )
      }
      currentUrl = parsePublicUrl(new URL(location, currentUrl).toString())
      continue
    }

    if (response.status < 200 || response.status >= 300) {
      throw new PublicResourceFetchError(
        `Public resource responded with HTTP ${response.status}.`,
        502,
        'upstream_http_error'
      )
    }

    const contentType = normalizeContentType(firstHeader(response.headers['content-type']))
    if (!PUBLIC_RESOURCE_CONTENT_TYPES.includes(contentType as (typeof PUBLIC_RESOURCE_CONTENT_TYPES)[number])) {
      throw new PublicResourceFetchError(
        'Public resource content type is not supported.',
        415,
        'unsupported_content_type'
      )
    }
    if (response.body.length === 0) {
      throw new PublicResourceFetchError('Public resource payload is empty.', 502, 'empty_payload')
    }
    if (response.body.length > maxBytes) {
      throw new PublicResourceFetchError(
        'Public resource payload exceeds maximum size.',
        413,
        'payload_too_large'
      )
    }

    const result: PublicResourceResponse = {
      finalUrl: currentUrl.toString(),
      status: response.status,
      contentType,
      body: response.body,
    }
    const etag = firstHeader(response.headers.etag)
    const lastModified = firstHeader(response.headers['last-modified'])
    const link = firstHeader(response.headers.link)
    if (etag) result.etag = etag
    if (lastModified) result.lastModified = lastModified
    if (link) result.link = link
    return result
  }

  throw new PublicResourceFetchError(
    'Public resource retrieval exceeded redirect limit.',
    502,
    'too_many_redirects'
  )
}

export function createCredentialFreePublicFetch(
  options: PublicResourceFetcherOptions = {}
): typeof globalThis.fetch {
  return async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET') {
      throw new PublicResourceFetchError(
        'Credential-free discovery fetch supports GET only.',
        405,
        'method_not_allowed'
      )
    }
    const result = await fetchPublicResource(String(input), options)
    const headers = new Headers({ 'content-type': result.contentType })
    if (result.etag) headers.set('etag', result.etag)
    if (result.lastModified) headers.set('last-modified', result.lastModified)
    if (result.link) headers.set('link', result.link)
    const response = new Response(new Uint8Array(result.body), {
      status: result.status,
      headers,
    })
    Object.defineProperty(response, 'url', { value: result.finalUrl })
    return response
  }
}

export async function postPublicResource(
  rawUrl: string,
  body: Buffer,
  contentType: string,
  options: PublicResourceDeliveryOptions = {}
): Promise<PublicResourceDeliveryResponse> {
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const maxRequestBytes = positiveInteger(options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES)
  const maxResponseBytes = positiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES)
  const maxRedirects = nonNegativeInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS)
  const resolveHost = options.resolveHost ?? lookup
  const requestOnce = options.requestOnce ?? requestPinnedHttpsPost
  const userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT

  if (body.length === 0) {
    throw new PublicResourceFetchError('Delivery payload is empty.', 400, 'empty_payload')
  }
  if (body.length > maxRequestBytes) {
    throw new PublicResourceFetchError(
      'Delivery payload exceeds maximum size.',
      413,
      'payload_too_large'
    )
  }
  if (!contentType.trim()) {
    throw new PublicResourceFetchError('Delivery content type is required.', 400, 'missing_content_type')
  }

  let currentUrl = parsePublicUrl(rawUrl)
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const addresses = await resolvePublicAddresses(currentUrl.hostname, resolveHost)
    const response = await requestOnce({
      url: currentUrl,
      addresses,
      timeoutMs,
      maxResponseBytes,
      userAgent,
      contentType,
      body,
    })

    if (response.status === 307 || response.status === 308) {
      const location = firstHeader(response.headers.location)
      if (!location) {
        throw new PublicResourceFetchError(
          'Delivery redirect is missing a location.',
          502,
          'redirect_missing_location'
        )
      }
      if (redirectCount === maxRedirects) {
        throw new PublicResourceFetchError('Delivery has too many redirects.', 502, 'too_many_redirects')
      }
      currentUrl = parsePublicUrl(new URL(location, currentUrl).toString())
      continue
    }
    if (response.status >= 300 && response.status < 400) {
      throw new PublicResourceFetchError(
        'Delivery redirect status is not safe for POST replay.',
        502,
        'unsafe_redirect_status'
      )
    }
    if (response.status < 200 || response.status >= 300) {
      throw new PublicResourceFetchError(
        `Delivery endpoint responded with HTTP ${response.status}.`,
        502,
        'upstream_http_error'
      )
    }
    if (response.body.length > maxResponseBytes) {
      throw new PublicResourceFetchError(
        'Delivery response exceeds maximum size.',
        413,
        'payload_too_large'
      )
    }

    const result: PublicResourceDeliveryResponse = {
      finalUrl: currentUrl.toString(),
      status: response.status,
    }
    const location = firstHeader(response.headers.location)
    if (location) result.location = new URL(location, currentUrl).toString()
    return result
  }

  throw new PublicResourceFetchError('Delivery exceeded redirect limit.', 502, 'too_many_redirects')
}

export function parsePublicUrl(rawUrl: string): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new PublicResourceFetchError('Public resource URL is invalid.', 400, 'invalid_url')
  }

  if (parsed.protocol !== 'https:') {
    throw new PublicResourceFetchError(
      'Public resource URL must use https.',
      400,
      'invalid_protocol'
    )
  }
  if (parsed.username || parsed.password) {
    throw new PublicResourceFetchError(
      'Public resource URL credentials are not allowed.',
      400,
      'invalid_credentials'
    )
  }
  if (parsed.port && parsed.port !== '443') {
    throw new PublicResourceFetchError(
      'Public resource URL must use the default https port.',
      400,
      'invalid_port'
    )
  }
  const host = parsed.hostname.trim().toLowerCase()
  if (!host || host === 'localhost' || isBlockedAddress(host)) {
    throw new PublicResourceFetchError('Public resource host is not allowed.', 400, 'blocked_host')
  }
  parsed.hash = ''
  return parsed
}

export async function resolvePublicAddresses(
  hostname: string,
  resolver: typeof lookup = lookup
): Promise<Array<{ address: string; family: number }>> {
  const resolved = await resolver(hostname, { all: true, verbatim: true }).catch(() => [])
  if (resolved.length === 0) {
    throw new PublicResourceFetchError(
      'Public resource host could not be resolved.',
      400,
      'unresolvable_host'
    )
  }
  if (resolved.some((entry) => isBlockedAddress(entry.address))) {
    throw new PublicResourceFetchError(
      'Public resource host resolves to a blocked address.',
      400,
      'blocked_host'
    )
  }
  return resolved.map((entry) => ({ address: entry.address, family: entry.family }))
}

export function isBlockedAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1]
  if (mappedIpv4) return isBlockedAddress(mappedIpv4)

  const version = isIP(normalized)
  if (version === 4) {
    const octets = normalized.split('.').map(Number)
    if (octets[0] === 0 || octets[0] === 10 || octets[0] === 127) return true
    if (octets[0] === 169 && octets[1] === 254) return true
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
    if (octets[0] === 192 && octets[1] === 168) return true
    if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true
    if (octets[0] >= 224) return true
    return false
  }

  if (version === 6) {
    const hextets = parseIpv6Hextets(normalized)
    if (
      hextets &&
      (hextets.every((part) => part === 0) ||
        (hextets.slice(0, 7).every((part) => part === 0) && hextets[7] === 1))
    ) return true
    const mappedAddress = extractMappedIpv4(normalized)
    if (mappedAddress) return isBlockedAddress(mappedAddress)
    const embeddedIpv4 = hextets ? extractEmbeddedIpv4(hextets) : null
    if (embeddedIpv4 && isBlockedAddress(embeddedIpv4)) return true
    if (normalized === '::' || normalized === '::1') return true
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
    if (/^fe[89ab]/.test(normalized)) return true
    if (hextets && (hextets[0] & 0xffc0) === 0xfec0) return true
    if (hextets && hextets[0] === 0x64 && hextets[1] === 0xff9b && hextets[2] === 1) return true
    if (normalized.startsWith('ff')) return true
    return false
  }

  return false
}

function extractEmbeddedIpv4(hextets: number[]): string | null {
  const fromWords = (high: number, low: number): string =>
    `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
  if (hextets.slice(0, 6).every((part) => part === 0)) {
    return fromWords(hextets[6] ?? 0, hextets[7] ?? 0)
  }
  if (
    hextets[0] === 0x64 &&
    hextets[1] === 0xff9b &&
    hextets.slice(2, 6).every((part) => part === 0)
  ) {
    return fromWords(hextets[6] ?? 0, hextets[7] ?? 0)
  }
  if (hextets[0] === 0x2002) {
    return fromWords(hextets[1] ?? 0, hextets[2] ?? 0)
  }
  if (hextets[0] === 0x2001 && hextets[1] === 0) {
    return fromWords((hextets[6] ?? 0) ^ 0xffff, (hextets[7] ?? 0) ^ 0xffff)
  }
  return null
}

function extractMappedIpv4(address: string): string | null {
  const hextets = parseIpv6Hextets(address)
  if (
    !hextets ||
    hextets.slice(0, 5).some((part) => part !== 0) ||
    hextets[5] !== 0xffff
  ) return null
  const high = hextets[6] ?? 0
  const low = hextets[7] ?? 0
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
}

function parseIpv6Hextets(address: string): number[] | null {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const hextets = [
    ...left,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'),
    ...right,
  ].map((part) => Number.parseInt(part || '0', 16))
  if (
    hextets.length !== 8 ||
    hextets.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)
  ) return null
  return hextets
}

async function requestPinnedHttps(
  input: PublicResourceRequestInput
): Promise<PublicResourceRequestResult> {
  return new Promise((resolve, reject) => {
    const address = input.addresses[0]
    if (!address) {
      reject(new PublicResourceFetchError('No validated address is available.', 400, 'unresolvable_host'))
      return
    }

    const request = httpsRequest(input.url, {
      method: 'GET',
      headers: {
        accept: PUBLIC_RESOURCE_CONTENT_TYPES.join(', '),
        'user-agent': input.userAgent,
      },
      servername: input.url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => {
      const chunks: Buffer[] = []
      let byteLength = 0
      const declaredLength = Number(response.headers['content-length'] ?? '0')
      if (declaredLength > input.maxBytes) {
        response.destroy()
        reject(new PublicResourceFetchError(
          'Public resource payload exceeds maximum size.',
          413,
          'payload_too_large'
        ))
        return
      }

      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        byteLength += buffer.length
        if (byteLength > input.maxBytes) {
          response.destroy(new PublicResourceFetchError(
            'Public resource payload exceeds maximum size.',
            413,
            'payload_too_large'
          ))
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => resolve({
        status: response.statusCode ?? 502,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
      response.on('error', reject)
    })

    request.setTimeout(input.timeoutMs, () => {
      request.destroy(new PublicResourceFetchError(
        'Public resource request timed out.',
        504,
        'timeout'
      ))
    })
    const wallClockTimer = setTimeout(() => {
      request.destroy(new PublicResourceFetchError(
        'Public resource request exceeded its wall-clock deadline.',
        504,
        'timeout'
      ))
    }, input.timeoutMs)
    request.once('close', () => clearTimeout(wallClockTimer))
    request.on('error', (error) => {
      if (error instanceof PublicResourceFetchError) reject(error)
      else reject(new PublicResourceFetchError(
        error.message || 'Public resource request failed.',
        502,
        'fetch_failed'
      ))
    })
    request.end()
  })
}

async function requestPinnedHttpsPost(
  input: PublicResourcePostRequestInput
): Promise<PublicResourceRequestResult> {
  return requestPinnedHttpsWithBody(input)
}

async function requestPinnedHttpsWithBody(
  input: PublicResourcePostRequestInput
): Promise<PublicResourceRequestResult> {
  return new Promise((resolve, reject) => {
    const address = input.addresses[0]
    if (!address) {
      reject(new PublicResourceFetchError('No validated address is available.', 400, 'unresolvable_host'))
      return
    }

    const request = httpsRequest(input.url, {
      method: 'POST',
      headers: {
        accept: 'application/ld+json, application/json',
        'content-type': input.contentType,
        'content-length': String(input.body.length),
        'user-agent': input.userAgent,
      },
      servername: input.url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => {
      const chunks: Buffer[] = []
      let byteLength = 0
      const declaredLength = Number(response.headers['content-length'] ?? '0')
      if (declaredLength > input.maxResponseBytes) {
        response.destroy()
        reject(new PublicResourceFetchError(
          'Delivery response exceeds maximum size.',
          413,
          'payload_too_large'
        ))
        return
      }
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        byteLength += buffer.length
        if (byteLength > input.maxResponseBytes) {
          response.destroy(new PublicResourceFetchError(
            'Delivery response exceeds maximum size.',
            413,
            'payload_too_large'
          ))
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => resolve({
        status: response.statusCode ?? 502,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
      response.on('error', reject)
    })

    request.setTimeout(input.timeoutMs, () => {
      request.destroy(new PublicResourceFetchError('Delivery request timed out.', 504, 'timeout'))
    })
    request.on('error', (error) => {
      if (error instanceof PublicResourceFetchError) reject(error)
      else reject(new PublicResourceFetchError(
        error.message || 'Delivery request failed.',
        502,
        'fetch_failed'
      ))
    })
    request.end(input.body)
  })
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function normalizeContentType(value: string | null): string {
  return (value ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback
}
