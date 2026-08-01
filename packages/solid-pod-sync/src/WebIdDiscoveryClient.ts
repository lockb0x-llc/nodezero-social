import {
  getSolidDataset,
  getThing,
  getUrl,
} from '@inrupt/solid-client'
import {
  DISCOVERY_MANIFEST_CLASS,
  PublicTypeIndexManager,
} from './PublicTypeIndexManager.js'

const LDP_INBOX = 'http://www.w3.org/ns/ldp#inbox'
const SOLID_PUBLIC_TYPE_INDEX = 'http://www.w3.org/ns/solid/terms#publicTypeIndex'

export interface WebIdDiscoveryResult {
  webId: string
  profileUrl: string
  inboxUrl: string | null
  publicTypeIndexUrl: string | null
  discoveryManifestUrl: string | null
  authenticated: false
}

export interface WebIdDiscoveryClientOptions {
  /** Must be a credential-free fetch implementation for public resources. */
  publicFetch: typeof globalThis.fetch
}

export class WebIdDiscoveryClient {
  private readonly typeIndexManager: PublicTypeIndexManager

  constructor(private readonly options: WebIdDiscoveryClientOptions) {
    this.typeIndexManager = new PublicTypeIndexManager({ fetch: options.publicFetch })
  }

  async discover(webId: string): Promise<WebIdDiscoveryResult> {
    const parsedWebId = validateWebId(webId)
    const profileUrl = parsedWebId.href.split('#')[0] ?? parsedWebId.href
    let linkHeader: string | null = null
    const captureFetch: typeof globalThis.fetch = async (input, init) => {
      const response = await this.options.publicFetch(input, init)
      linkHeader = response.headers.get('link')
      return response
    }

    const dataset = await getSolidDataset(profileUrl, { fetch: captureFetch })
    const profile = getThing(dataset, webId)
    const inboxFromBody = profile ? getUrl(profile, LDP_INBOX) : null
    const typeIndexFromBody = profile ? getUrl(profile, SOLID_PUBLIC_TYPE_INDEX) : null
    const links = parseLinkHeader(linkHeader, profileUrl)
    const inboxUrl = inboxFromBody ?? links.get(LDP_INBOX) ?? null
    const publicTypeIndexUrl = typeIndexFromBody ?? links.get(SOLID_PUBLIC_TYPE_INDEX) ?? null

    let discoveryManifestUrl: string | null = null
    if (publicTypeIndexUrl) {
      const registrations = await this.typeIndexManager.listRegistrations(publicTypeIndexUrl)
      discoveryManifestUrl =
        registrations.find((registration) => registration.forClass === DISCOVERY_MANIFEST_CLASS)
          ?.instance ?? null
    }

    return {
      webId,
      profileUrl,
      inboxUrl,
      publicTypeIndexUrl,
      discoveryManifestUrl,
      authenticated: false,
    }
  }
}

export function parseLinkHeader(value: string | null, baseUrl: string): Map<string, string> {
  const links = new Map<string, string>()
  if (!value) return links

  const pattern = /<([^>]+)>\s*;\s*rel\s*=\s*(?:"([^"]+)"|([^;,\s]+))/gi
  for (const match of value.matchAll(pattern)) {
    const target = match[1]
    const rels = (match[2] ?? match[3] ?? '').split(/\s+/).filter(Boolean)
    if (!target) continue
    let resolvedTarget: URL
    try {
      resolvedTarget = new URL(target, baseUrl)
    } catch {
      continue
    }
    if (resolvedTarget.protocol !== 'https:') continue
    const absoluteTarget = resolvedTarget.toString()
    for (const rel of rels) {
      if (!links.has(rel)) links.set(rel, absoluteTarget)
    }
  }
  return links
}

function validateWebId(webId: string): URL {
  let parsed: URL
  try {
    parsed = new URL(webId)
  } catch {
    throw new Error('WebID must be an absolute https URL with a fragment identifier.')
  }
  if (parsed.protocol !== 'https:' || parsed.hash.length <= 1) {
    throw new Error('WebID must be an absolute https URL with a fragment identifier.')
  }
  return parsed
}
