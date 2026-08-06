import {
  getBoolean,
  getInteger,
  getSolidDataset,
  getStringNoLocale,
  getThing,
  getUrl,
  type SolidDataset,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'
import {
  assertValidDiscoveryConsent,
  createDefaultDiscoveryConsent,
  type DiscoveryConsent,
} from './contracts/ConsentfulDiscoveryContract.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  deriveOwnerWebId,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface DiscoveryConsentManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
  }
}

export type DiscoveryConsentPatch = Partial<
  Pick<
    DiscoveryConsent,
    | 'publicListing'
    | 'publicIndexing'
    | 'nearbyPresence'
    | 'inboundContactRequests'
    | 'localBroadcasts'
  >
>

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const NZ_DISCOVERY_CONSENT = 'https://nodezero.social/ns#DiscoveryConsent'
const NZ_VERSION = 'https://nodezero.social/ns#version'
const NZ_REVISION = 'https://nodezero.social/ns#revision'
const NZ_OWNER_WEB_ID = 'https://nodezero.social/ns#ownerWebId'
const NZ_PUBLIC_LISTING = 'https://nodezero.social/ns#publicListing'
const NZ_PUBLIC_INDEXING = 'https://nodezero.social/ns#publicIndexing'
const NZ_NEARBY_PRESENCE = 'https://nodezero.social/ns#nearbyPresence'
const NZ_INBOUND_CONTACT_REQUESTS = 'https://nodezero.social/ns#inboundContactRequests'
const NZ_LOCAL_BROADCASTS = 'https://nodezero.social/ns#localBroadcasts'
const NZ_UPDATED_AT = 'https://nodezero.social/ns#updatedAt'
const MAX_WRITE_ATTEMPTS = 5

function consentUrl(podRoot: string): string {
  return `${podRoot.replace(/\/$/, '')}/social/consent/discovery`
}

function consentThingUrl(podRoot: string): string {
  return `${consentUrl(podRoot)}#consent`
}

export class DiscoveryConsentManager {
  constructor(
    private readonly session: AuthenticatedSession,
    private readonly options: DiscoveryConsentManagerOptions = {}
  ) {}

  async readConsent(podRoot: string, now = new Date()): Promise<DiscoveryConsent> {
    const ownerWebId = deriveOwnerWebId(`${podRoot.replace(/\/$/, '')}/social/consent/`)
    const { dataset } = await this.readSnapshot(podRoot)
    if (!dataset) return createDefaultDiscoveryConsent(ownerWebId, now.toISOString())
    const thing = getThing(dataset, consentThingUrl(podRoot))
    if (!thing) return createDefaultDiscoveryConsent(ownerWebId, now.toISOString())
    const consent: DiscoveryConsent = {
      version: getInteger(thing, NZ_VERSION) as 1,
      revision: getInteger(thing, NZ_REVISION) ?? 0,
      ownerWebId: getUrl(thing, NZ_OWNER_WEB_ID) ?? '',
      publicListing: getBoolean(thing, NZ_PUBLIC_LISTING) ?? false,
      publicIndexing: getBoolean(thing, NZ_PUBLIC_INDEXING) ?? false,
      nearbyPresence: getBoolean(thing, NZ_NEARBY_PRESENCE) ?? false,
      inboundContactRequests: getBoolean(thing, NZ_INBOUND_CONTACT_REQUESTS) ?? false,
      localBroadcasts: getBoolean(thing, NZ_LOCAL_BROADCASTS) ?? false,
      updatedAt: getStringNoLocale(thing, NZ_UPDATED_AT) ?? '',
    }
    assertValidDiscoveryConsent(consent)
    if (consent.ownerWebId !== ownerWebId) throw new Error('Discovery consent owner mismatch.')
    return consent
  }

  async updateConsent(
    podRoot: string,
    patch: DiscoveryConsentPatch,
    updatedAt = new Date().toISOString(),
    expected?: DiscoveryConsentPatch
  ): Promise<DiscoveryConsent> {
    await this.ensurePodLayoutIfEnabled(podRoot)
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const snapshot = await this.readSnapshot(podRoot)
      const current = snapshot.dataset
        ? this.parseConsent(podRoot, snapshot.dataset)
        : createDefaultDiscoveryConsent(
            deriveOwnerWebId(`${podRoot.replace(/\/$/, '')}/social/consent/`),
            updatedAt
          )
      if (
        expected &&
        Object.entries(expected).some(
          ([key, value]) => current[key as keyof DiscoveryConsentPatch] !== value
        )
      ) {
        throw new Error('Discovery consent changed concurrently; retry the operation.')
      }
      const consent: DiscoveryConsent = {
        ...current,
        ...patch,
        revision: (current.revision ?? 0) + 1,
        updatedAt,
      }
      assertValidDiscoveryConsent(consent)
      const response = snapshot.dataset
        ? await this.patchExistingConsent(podRoot, consent, patch, snapshot.etag)
        : await this.createConsent(podRoot, consent)
      if (
        (response.status === 409 || response.status === 412) &&
        attempt < MAX_WRITE_ATTEMPTS - 1
      ) {
        continue
      }
      if (!response.ok) {
        throw new Error(`Failed to update discovery consent: HTTP ${response.status}`)
      }
      return consent
    }
    throw new Error('Discovery consent changed concurrently; retry the operation.')
  }

  private parseConsent(
    podRoot: string,
    dataset: SolidDataset & Partial<WithServerResourceInfo>
  ): DiscoveryConsent {
    const thing = getThing(dataset, consentThingUrl(podRoot))
    if (!thing) throw new Error('Discovery consent dataset is missing its consent Thing.')
    const consent: DiscoveryConsent = {
      version: getInteger(thing, NZ_VERSION) as 1,
      revision: getInteger(thing, NZ_REVISION) ?? 0,
      ownerWebId: getUrl(thing, NZ_OWNER_WEB_ID) ?? '',
      publicListing: getBoolean(thing, NZ_PUBLIC_LISTING) ?? false,
      publicIndexing: getBoolean(thing, NZ_PUBLIC_INDEXING) ?? false,
      nearbyPresence: getBoolean(thing, NZ_NEARBY_PRESENCE) ?? false,
      inboundContactRequests: getBoolean(thing, NZ_INBOUND_CONTACT_REQUESTS) ?? false,
      localBroadcasts: getBoolean(thing, NZ_LOCAL_BROADCASTS) ?? false,
      updatedAt: getStringNoLocale(thing, NZ_UPDATED_AT) ?? '',
    }
    assertValidDiscoveryConsent(consent)
    const ownerWebId = deriveOwnerWebId(`${podRoot.replace(/\/$/, '')}/social/consent/`)
    if (consent.ownerWebId !== ownerWebId) throw new Error('Discovery consent owner mismatch.')
    return consent
  }

  private async readSnapshot(podRoot: string): Promise<{
    dataset: (SolidDataset & Partial<WithServerResourceInfo>) | null
    etag: string | null
  }> {
    const datasetUrl = consentUrl(podRoot)
    let etag: string | null = null
    const observedFetch: typeof globalThis.fetch = async (input, init) => {
      const response = await this.session.fetch(input, init)
      const target =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if ((init?.method ?? 'GET').toUpperCase() === 'GET' && target === datasetUrl && response.ok) {
        etag = response.headers.get('etag')
      }
      return response
    }
    try {
      const dataset = await getSolidDataset(datasetUrl, { fetch: observedFetch })
      return { dataset, etag }
    } catch (error) {
      if (isNotFoundError(error)) return { dataset: null, etag: null }
      throw error
    }
  }

  private createConsent(podRoot: string, consent: DiscoveryConsent): Promise<Response> {
    return this.session.fetch(consentUrl(podRoot), {
      method: 'PUT',
      headers: { 'content-type': 'text/turtle', 'if-none-match': '*' },
      body: serializeConsent(consentThingUrl(podRoot), consent),
    })
  }

  private patchExistingConsent(
    podRoot: string,
    consent: DiscoveryConsent,
    patch: DiscoveryConsentPatch,
    etag: string | null
  ): Promise<Response> {
    if (!etag) {
      throw new Error('Discovery consent is missing an ETag; refusing an unsafe update.')
    }
    return this.session
      .fetch(consentUrl(podRoot), {
        method: 'PATCH',
        headers: { 'content-type': 'application/sparql-update', 'if-match': etag },
        body: serializeConsentPatch(consentThingUrl(podRoot), consent, patch),
      })
      .then((response) => {
        if (![405, 415, 501].includes(response.status)) return response
        return this.session.fetch(consentUrl(podRoot), {
          method: 'PUT',
          headers: { 'content-type': 'text/turtle', 'if-match': etag },
          body: serializeConsent(consentThingUrl(podRoot), consent),
        })
      })
  }

  private async ensurePodLayoutIfEnabled(podRoot: string): Promise<void> {
    if (!this.options.enablePodBootstrap) return
    const manager =
      this.options.podLayoutManager ?? new PodLayoutManager({ fetch: this.session.fetch })
    await manager.ensureDefaultLayoutAndPolicies(
      podRoot,
      this.options.policyMatrix ?? DEFAULT_POLICY_MATRIX
    )
  }
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as {
    statusCode?: unknown
    status?: unknown
    response?: { status?: unknown }
  }
  return (
    candidate.statusCode === 404 || candidate.status === 404 || candidate.response?.status === 404
  )
}

const CONSENT_BOOLEAN_PREDICATES: Readonly<Record<keyof DiscoveryConsentPatch, string>> = {
  publicListing: NZ_PUBLIC_LISTING,
  publicIndexing: NZ_PUBLIC_INDEXING,
  nearbyPresence: NZ_NEARBY_PRESENCE,
  inboundContactRequests: NZ_INBOUND_CONTACT_REQUESTS,
  localBroadcasts: NZ_LOCAL_BROADCASTS,
}

function serializeConsent(thingUrl: string, consent: DiscoveryConsent): string {
  return [
    `${iri(thingUrl)} ${iri(RDF_TYPE)} ${iri(NZ_DISCOVERY_CONSENT)} .`,
    `${iri(thingUrl)} ${iri(NZ_VERSION)} ${consent.version} .`,
    `${iri(thingUrl)} ${iri(NZ_REVISION)} ${consent.revision ?? 0} .`,
    `${iri(thingUrl)} ${iri(NZ_OWNER_WEB_ID)} ${iri(consent.ownerWebId)} .`,
    ...Object.entries(CONSENT_BOOLEAN_PREDICATES).map(
      ([key, predicate]) =>
        `${iri(thingUrl)} ${iri(predicate)} ${consent[key as keyof DiscoveryConsentPatch]} .`
    ),
    `${iri(thingUrl)} ${iri(NZ_UPDATED_AT)} ${literal(consent.updatedAt)} .`,
  ].join('\n')
}

function serializeConsentPatch(
  thingUrl: string,
  consent: DiscoveryConsent,
  patch: DiscoveryConsentPatch
): string {
  const values = [
    ...Object.keys(patch).map((key) => ({
      predicate: CONSENT_BOOLEAN_PREDICATES[key as keyof DiscoveryConsentPatch],
      value: String(consent[key as keyof DiscoveryConsentPatch]),
    })),
    { predicate: NZ_REVISION, value: String(consent.revision ?? 0) },
    { predicate: NZ_UPDATED_AT, value: literal(consent.updatedAt) },
  ]
  return [
    'DELETE {',
    ...values.map(({ predicate }, index) => `  ${iri(thingUrl)} ${iri(predicate)} ?old${index} .`),
    '}',
    'INSERT {',
    ...values.map(({ predicate, value }) => `  ${iri(thingUrl)} ${iri(predicate)} ${value} .`),
    '}',
    'WHERE {',
    ...values.map(
      ({ predicate }, index) => `  OPTIONAL { ${iri(thingUrl)} ${iri(predicate)} ?old${index} . }`
    ),
    '}',
  ].join('\n')
}

function iri(value: string): string {
  if (
    value.includes('<') ||
    value.includes('>') ||
    Array.from(value).some((character) => character.charCodeAt(0) <= 0x20)
  ) {
    throw new Error('Invalid consent IRI.')
  }
  return `<${value}>`
}

function literal(value: string): string {
  return JSON.stringify(value)
}

export const DISCOVERY_CONSENT_DATASET_PATH = 'social/consent/discovery'
