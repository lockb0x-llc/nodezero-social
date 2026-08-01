import {
  buildThing,
  createSolidDataset,
  createThing,
  getBoolean,
  getInteger,
  getSolidDataset,
  getStringNoLocale,
  getThing,
  getUrl,
  saveSolidDatasetAt,
  setThing,
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

export type DiscoveryConsentPatch = Partial<Pick<
  DiscoveryConsent,
  | 'publicListing'
  | 'publicIndexing'
  | 'nearbyPresence'
  | 'inboundContactRequests'
  | 'localBroadcasts'
>>

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const NZ_DISCOVERY_CONSENT = 'https://nodezero.social/ns#DiscoveryConsent'
const NZ_VERSION = 'https://nodezero.social/ns#version'
const NZ_OWNER_WEB_ID = 'https://nodezero.social/ns#ownerWebId'
const NZ_PUBLIC_LISTING = 'https://nodezero.social/ns#publicListing'
const NZ_PUBLIC_INDEXING = 'https://nodezero.social/ns#publicIndexing'
const NZ_NEARBY_PRESENCE = 'https://nodezero.social/ns#nearbyPresence'
const NZ_INBOUND_CONTACT_REQUESTS = 'https://nodezero.social/ns#inboundContactRequests'
const NZ_LOCAL_BROADCASTS = 'https://nodezero.social/ns#localBroadcasts'
const NZ_UPDATED_AT = 'https://nodezero.social/ns#updatedAt'

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
    const dataset = await this.readDataset(podRoot)
    if (!dataset) return createDefaultDiscoveryConsent(ownerWebId, now.toISOString())
    const thing = getThing(dataset, consentThingUrl(podRoot))
    if (!thing) return createDefaultDiscoveryConsent(ownerWebId, now.toISOString())
    const consent: DiscoveryConsent = {
      version: getInteger(thing, NZ_VERSION) as 1,
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
    updatedAt = new Date().toISOString()
  ): Promise<DiscoveryConsent> {
    await this.ensurePodLayoutIfEnabled(podRoot)
    const current = await this.readConsent(podRoot, new Date(updatedAt))
    const consent: DiscoveryConsent = { ...current, ...patch, updatedAt }
    assertValidDiscoveryConsent(consent)
    const datasetUrl = consentUrl(podRoot)
    const thingUrl = consentThingUrl(podRoot)
    const dataset = (await this.readDataset(podRoot)) ?? createSolidDataset()
    const existing = getThing(dataset, thingUrl) ?? createThing({ url: thingUrl })
    const thing = buildThing(existing)
      .removeAll(RDF_TYPE)
      .removeAll(NZ_VERSION)
      .removeAll(NZ_OWNER_WEB_ID)
      .removeAll(NZ_PUBLIC_LISTING)
      .removeAll(NZ_PUBLIC_INDEXING)
      .removeAll(NZ_NEARBY_PRESENCE)
      .removeAll(NZ_INBOUND_CONTACT_REQUESTS)
      .removeAll(NZ_LOCAL_BROADCASTS)
      .removeAll(NZ_UPDATED_AT)
      .setUrl(RDF_TYPE, NZ_DISCOVERY_CONSENT)
      .setInteger(NZ_VERSION, consent.version)
      .setUrl(NZ_OWNER_WEB_ID, consent.ownerWebId)
      .setBoolean(NZ_PUBLIC_LISTING, consent.publicListing)
      .setBoolean(NZ_PUBLIC_INDEXING, consent.publicIndexing)
      .setBoolean(NZ_NEARBY_PRESENCE, consent.nearbyPresence)
      .setBoolean(NZ_INBOUND_CONTACT_REQUESTS, consent.inboundContactRequests)
      .setBoolean(NZ_LOCAL_BROADCASTS, consent.localBroadcasts)
      .setStringNoLocale(NZ_UPDATED_AT, consent.updatedAt)
      .build()
    await saveSolidDatasetAt(datasetUrl, setThing(dataset, thing), { fetch: this.session.fetch })
    return consent
  }

  private async readDataset(
    podRoot: string
  ): Promise<(SolidDataset & Partial<WithServerResourceInfo>) | null> {
    try {
      return await getSolidDataset(consentUrl(podRoot), { fetch: this.session.fetch })
    } catch (error) {
      if (isNotFoundError(error)) return null
      throw error
    }
  }

  private async ensurePodLayoutIfEnabled(podRoot: string): Promise<void> {
    if (!this.options.enablePodBootstrap) return
    const manager = this.options.podLayoutManager ?? new PodLayoutManager({ fetch: this.session.fetch })
    await manager.ensureDefaultLayoutAndPolicies(
      podRoot,
      this.options.policyMatrix ?? DEFAULT_POLICY_MATRIX
    )
  }
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } }
  return candidate.statusCode === 404 || candidate.status === 404 || candidate.response?.status === 404
}

export const DISCOVERY_CONSENT_DATASET_PATH = 'social/consent/discovery'
