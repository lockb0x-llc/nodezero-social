import {
  buildThing,
  createSolidDataset,
  createThing,
  getInteger,
  getStringNoLocale,
  getStringNoLocaleAll,
  getThing,
  getUrl,
  setThing,
  type SolidDataset,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'
import {
  assertValidDiscoveryManifest,
  type DiscoveryManifest,
} from './contracts/ConsentfulDiscoveryContract.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  deriveOwnerWebId,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'
import {
  getSolidDatasetSnapshot,
  saveSolidDatasetWithPatchFallback,
} from './saveSolidDatasetCompat.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface DiscoveryManifestManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
  }
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const NZ_DISCOVERY_MANIFEST = 'https://nodezero.social/ns#DiscoveryManifest'
const NZ_VERSION = 'https://nodezero.social/ns#version'
const NZ_WEB_ID = 'https://nodezero.social/ns#webId'
const NZ_PUBLISHED_AT = 'https://nodezero.social/ns#publishedAt'
const NZ_EXPIRES_AT = 'https://nodezero.social/ns#expiresAt'
const NZ_DISPLAY_NAME = 'https://nodezero.social/ns#displayName'
const NZ_AVATAR_URL = 'https://nodezero.social/ns#avatarUrl'
const SOLID_PUBLIC_TYPE_INDEX = 'http://www.w3.org/ns/solid/terms#publicTypeIndex'
const NZ_PUBLIC_INTEREST = 'https://nodezero.social/ns#publicInterest'
const NZ_CAPABILITY = 'https://nodezero.social/ns#capability'
const LDP_INBOX = 'http://www.w3.org/ns/ldp#inbox'

function manifestUrl(podRoot: string): string {
  return `${podRoot.replace(/\/$/, '')}/public/discovery/manifest`
}

function manifestThingUrl(podRoot: string): string {
  return `${manifestUrl(podRoot)}#manifest`
}

export class DiscoveryManifestManager {
  constructor(
    private readonly session: AuthenticatedSession,
    private readonly options: DiscoveryManifestManagerOptions = {}
  ) {}

  async readManifest(podRoot: string): Promise<DiscoveryManifest | null> {
    const datasetUrl = manifestUrl(podRoot)
    let dataset: SolidDataset & WithServerResourceInfo

    try {
      dataset = (await getSolidDatasetSnapshot(datasetUrl, this.session.fetch)).dataset
    } catch (error) {
      if (isNotFoundError(error)) return null
      throw error
    }

    const thing = getThing(dataset, manifestThingUrl(podRoot))
    if (!thing) return null

    const manifest: DiscoveryManifest = {
      version: getInteger(thing, NZ_VERSION) === 1 ? 1 : (getInteger(thing, NZ_VERSION) as 1),
      webId: getUrl(thing, NZ_WEB_ID) ?? '',
      publishedAt: getStringNoLocale(thing, NZ_PUBLISHED_AT) ?? '',
      expiresAt: getStringNoLocale(thing, NZ_EXPIRES_AT) ?? '',
    }

    const displayName = getStringNoLocale(thing, NZ_DISPLAY_NAME)
    const avatarUrl = getUrl(thing, NZ_AVATAR_URL)
    const publicTypeIndexUrl = getUrl(thing, SOLID_PUBLIC_TYPE_INDEX)
    const publicInterests = getStringNoLocaleAll(thing, NZ_PUBLIC_INTEREST)
    const capabilities = getStringNoLocaleAll(thing, NZ_CAPABILITY)
    const inboxUrl = getUrl(thing, LDP_INBOX)

    if (displayName !== null) manifest.displayName = displayName
    if (avatarUrl !== null) manifest.avatarUrl = avatarUrl
    if (publicTypeIndexUrl !== null) manifest.publicTypeIndexUrl = publicTypeIndexUrl
    if (publicInterests.length > 0) manifest.publicInterests = publicInterests
    if (capabilities.length > 0) manifest.capabilities = capabilities
    if (inboxUrl !== null) manifest.inboxUrl = inboxUrl

    assertValidDiscoveryManifest(manifest)
    return manifest
  }

  async writeManifest(podRoot: string, manifest: DiscoveryManifest): Promise<string> {
    await this.ensurePodLayoutIfEnabled(podRoot)
    assertValidDiscoveryManifest(manifest)

    const expectedOwnerWebId = deriveOwnerWebId(`${podRoot.replace(/\/$/, '')}/public/discovery/`)
    if (manifest.webId !== expectedOwnerWebId) {
      throw new Error(
        `Discovery manifest owner mismatch: '${manifest.webId}' does not match '${expectedOwnerWebId}'`
      )
    }
    if (manifest.publicTypeIndexUrl) {
      const typeIndex = new URL(manifest.publicTypeIndexUrl)
      const root = new URL(podRoot.endsWith('/') ? podRoot : `${podRoot}/`)
      if (typeIndex.origin !== root.origin || !typeIndex.pathname.startsWith(root.pathname)) {
        throw new Error(
          'Discovery manifest public Type Index must remain inside the owner Pod namespace'
        )
      }
    }

    const datasetUrl = manifestUrl(podRoot)
    const thingUrl = manifestThingUrl(podRoot)
    let dataset: SolidDataset & Partial<WithServerResourceInfo>
    let etag: string | null = null

    try {
      const snapshot = await getSolidDatasetSnapshot(datasetUrl, this.session.fetch)
      dataset = snapshot.dataset
      etag = snapshot.etag
    } catch (error) {
      if (!isNotFoundError(error)) throw error
      dataset = createSolidDataset()
    }

    let builder = buildThing(createThing({ url: thingUrl }))
      .setUrl(RDF_TYPE, NZ_DISCOVERY_MANIFEST)
      .setInteger(NZ_VERSION, manifest.version)
      .setUrl(NZ_WEB_ID, manifest.webId)
      .setStringNoLocale(NZ_PUBLISHED_AT, manifest.publishedAt)
      .setStringNoLocale(NZ_EXPIRES_AT, manifest.expiresAt)

    if (manifest.displayName)
      builder = builder.setStringNoLocale(NZ_DISPLAY_NAME, manifest.displayName)
    if (manifest.avatarUrl) builder = builder.setUrl(NZ_AVATAR_URL, manifest.avatarUrl)
    if (manifest.publicTypeIndexUrl) {
      builder = builder.setUrl(SOLID_PUBLIC_TYPE_INDEX, manifest.publicTypeIndexUrl)
    }
    if (manifest.inboxUrl) builder = builder.setUrl(LDP_INBOX, manifest.inboxUrl)
    for (const interest of manifest.publicInterests ?? []) {
      builder = builder.addStringNoLocale(NZ_PUBLIC_INTEREST, interest)
    }
    for (const capability of manifest.capabilities ?? []) {
      builder = builder.addStringNoLocale(NZ_CAPABILITY, capability)
    }

    const updated = setThing(dataset, builder.build())
    await saveSolidDatasetWithPatchFallback(datasetUrl, updated, this.session.fetch, etag)
    return datasetUrl
  }

  async removeManifest(podRoot: string): Promise<void> {
    const url = manifestUrl(podRoot)
    const response = await this.session.fetch(url, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to remove discovery manifest at ${url}: HTTP ${response.status}`)
    }
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

export const DISCOVERY_MANIFEST_DATASET_PATH = 'public/discovery/manifest'
