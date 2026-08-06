import {
  buildThing,
  createSolidDataset,
  createThing,
  getThing,
  getThingAll,
  getUrl,
  removeThing,
  setThing,
  type SolidDataset,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'
import {
  getSolidDatasetSnapshot,
  saveSolidDatasetWithPatchFallback,
} from './saveSolidDatasetCompat.js'
interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export const DISCOVERY_MANIFEST_CLASS = 'https://nodezero.social/ns#DiscoveryManifest'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const SOLID_PUBLIC_TYPE_INDEX = 'http://www.w3.org/ns/solid/terms#publicTypeIndex'
const SOLID_TYPE_INDEX = 'http://www.w3.org/ns/solid/terms#TypeIndex'
const SOLID_LISTED_DOCUMENT = 'http://www.w3.org/ns/solid/terms#ListedDocument'
const SOLID_TYPE_REGISTRATION = 'http://www.w3.org/ns/solid/terms#TypeRegistration'
const SOLID_FOR_CLASS = 'http://www.w3.org/ns/solid/terms#forClass'
const SOLID_INSTANCE = 'http://www.w3.org/ns/solid/terms#instance'

export interface PublicTypeRegistration {
  forClass: string
  instance: string
}

export class PublicTypeIndexManager {
  constructor(private readonly session: AuthenticatedSession) {}

  async discoverPublicTypeIndex(webId: string): Promise<string | null> {
    const profileUrl = webId.split('#')[0]
    const dataset = (await getSolidDatasetSnapshot(profileUrl, this.session.fetch)).dataset
    const profile = getThing(dataset, webId)
    return profile ? getUrl(profile, SOLID_PUBLIC_TYPE_INDEX) : null
  }

  async ensureDiscoveryManifestRegistration(
    podRoot: string,
    publicTypeIndexUrl: string,
    discoveryManifestUrl: string
  ): Promise<string> {
    assertOwnedResource(publicTypeIndexUrl, podRoot, 'publicTypeIndexUrl')
    assertOwnedResource(discoveryManifestUrl, podRoot, 'discoveryManifestUrl')

    let dataset: SolidDataset & Partial<WithServerResourceInfo>
    let etag: string | null = null
    try {
      const snapshot = await getSolidDatasetSnapshot(publicTypeIndexUrl, this.session.fetch)
      dataset = snapshot.dataset
      etag = snapshot.etag
    } catch (error) {
      if (!isNotFoundError(error)) throw error
      dataset = createSolidDataset()
    }

    const indexThing =
      getThing(dataset, publicTypeIndexUrl) ?? createThing({ url: publicTypeIndexUrl })
    const registrationUrl = `${publicTypeIndexUrl}#nodezero-discovery-manifest`
    const existingRegistration =
      getThing(dataset, registrationUrl) ?? createThing({ url: registrationUrl })

    const updatedIndex = buildThing(indexThing)
      .addUrl(RDF_TYPE, SOLID_TYPE_INDEX)
      .addUrl(RDF_TYPE, SOLID_LISTED_DOCUMENT)
      .build()
    const updatedRegistration = buildThing(existingRegistration)
      .removeAll(RDF_TYPE)
      .removeAll(SOLID_FOR_CLASS)
      .removeAll(SOLID_INSTANCE)
      .setUrl(RDF_TYPE, SOLID_TYPE_REGISTRATION)
      .setUrl(SOLID_FOR_CLASS, DISCOVERY_MANIFEST_CLASS)
      .setUrl(SOLID_INSTANCE, discoveryManifestUrl)
      .build()

    let updated = setThing(dataset, updatedIndex)
    updated = setThing(updated, updatedRegistration)
    await saveSolidDatasetWithPatchFallback(publicTypeIndexUrl, updated, this.session.fetch, etag)

    return registrationUrl
  }

  async removeDiscoveryManifestRegistration(
    podRoot: string,
    publicTypeIndexUrl: string
  ): Promise<void> {
    assertOwnedResource(publicTypeIndexUrl, podRoot, 'publicTypeIndexUrl')
    let snapshot
    try {
      snapshot = await getSolidDatasetSnapshot(publicTypeIndexUrl, this.session.fetch)
    } catch (error) {
      if (isNotFoundError(error)) return
      throw error
    }
    const dataset: SolidDataset & Partial<WithServerResourceInfo> = snapshot.dataset
    const registrationUrl = `${publicTypeIndexUrl}#nodezero-discovery-manifest`
    if (!getThing(dataset, registrationUrl)) return
    await saveSolidDatasetWithPatchFallback(
      publicTypeIndexUrl,
      removeThing(dataset, registrationUrl),
      this.session.fetch,
      snapshot.etag
    )
  }

  async listRegistrations(publicTypeIndexUrl: string): Promise<PublicTypeRegistration[]> {
    const dataset = (await getSolidDatasetSnapshot(publicTypeIndexUrl, this.session.fetch)).dataset
    const registrations: PublicTypeRegistration[] = []
    for (const thing of getThingAll(dataset)) {
      if (getUrl(thing, RDF_TYPE) !== SOLID_TYPE_REGISTRATION) continue
      const forClass = getUrl(thing, SOLID_FOR_CLASS)
      const instance = getUrl(thing, SOLID_INSTANCE)
      if (forClass && instance) registrations.push({ forClass, instance })
    }
    return registrations.sort((left, right) => left.forClass.localeCompare(right.forClass))
  }
}

function assertOwnedResource(resourceUrl: string, podRoot: string, field: string): void {
  const resource = new URL(resourceUrl)
  const root = new URL(podRoot.endsWith('/') ? podRoot : `${podRoot}/`)
  if (resource.origin !== root.origin || !resource.pathname.startsWith(root.pathname)) {
    throw new Error(`${field} must remain inside the owner Pod namespace`)
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
