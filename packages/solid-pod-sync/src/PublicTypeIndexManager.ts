import {
  buildThing,
  createSolidDataset,
  createThing,
  getInteger,
  getThing,
  getThingAll,
  getUrl,
  getUrlAll,
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
const NZ_PUBLICATION_REVISION = 'https://nodezero.social/ns#publicationRevision'

export interface PublicTypeRegistration {
  forClass: string
  instance: string
  publicationRevision?: number
}

export class PublicTypeIndexManager {
  constructor(private readonly session: AuthenticatedSession) {}

  async discoverPublicTypeIndex(webId: string): Promise<string | null> {
    const profileUrl = webId.split('#')[0]
    let dataset: SolidDataset
    try {
      dataset = (await getSolidDatasetSnapshot(profileUrl, this.session.fetch)).dataset
    } catch (error) {
      if (isNotFoundError(error)) return null
      throw error
    }
    const profile = getThing(dataset, webId)
    return profile ? getUrl(profile, SOLID_PUBLIC_TYPE_INDEX) : null
  }

  async ensurePublicTypeIndex(
    podRoot: string,
    webId: string,
    publicationRevision: number
  ): Promise<string> {
    const profileUrl = webId.split('#')[0]
    assertOwnedResource(profileUrl, podRoot, 'webId')

    const snapshot = await getSolidDatasetSnapshot(profileUrl, this.session.fetch)
    const profile = getThing(snapshot.dataset, webId)
    if (!profile) throw new Error('The owner WebID profile is unavailable.')

    const existing = getUrl(profile, SOLID_PUBLIC_TYPE_INDEX)
    if (existing) return existing

    const publicTypeIndexUrl = `${podRoot.replace(/\/$/, '')}/public/discovery/type-index`
    const updatedProfile = buildThing(profile)
      .setUrl(SOLID_PUBLIC_TYPE_INDEX, publicTypeIndexUrl)
      .build()
    const updatedDataset = setThing(snapshot.dataset, updatedProfile)
    await saveSolidDatasetWithPatchFallback(
      profileUrl,
      updatedDataset,
      this.session.fetch,
      snapshot.etag,
      { 'x-nodezero-publication-revision': String(publicationRevision) }
    )

    return publicTypeIndexUrl
  }

  async ensureDiscoveryManifestRegistration(
    podRoot: string,
    publicTypeIndexUrl: string,
    discoveryManifestUrl: string,
    publicationRevision?: number
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
    const currentPublicationRevision = getInteger(
      existingRegistration,
      NZ_PUBLICATION_REVISION
    )
    if (
      currentPublicationRevision !== null &&
      (publicationRevision === undefined || currentPublicationRevision > publicationRevision)
    ) {
      throw new Error('A newer discovery Type Index registration already exists.')
    }

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
    const revisionedRegistration =
      publicationRevision === undefined
        ? updatedRegistration
        : buildThing(updatedRegistration)
            .setInteger(NZ_PUBLICATION_REVISION, publicationRevision)
            .build()

    let updated = setThing(dataset, updatedIndex)
    updated = setThing(updated, revisionedRegistration)
    await saveSolidDatasetWithPatchFallback(
      publicTypeIndexUrl,
      updated,
      this.session.fetch,
      etag,
      { 'x-nodezero-publication-revision': String(publicationRevision ?? 0) }
    )

    return registrationUrl
  }

  async removeDiscoveryManifestRegistration(
    podRoot: string,
    publicTypeIndexUrl: string,
    maximumPublicationRevision?: number
  ): Promise<boolean> {
    assertOwnedResource(publicTypeIndexUrl, podRoot, 'publicTypeIndexUrl')
    let snapshot
    try {
      snapshot = await getSolidDatasetSnapshot(publicTypeIndexUrl, this.session.fetch)
    } catch (error) {
      if (isNotFoundError(error)) return true
      throw error
    }
    const dataset: SolidDataset & Partial<WithServerResourceInfo> = snapshot.dataset
    const registrationUrl = `${publicTypeIndexUrl}#nodezero-discovery-manifest`
    const registration = getThing(dataset, registrationUrl)
    if (!registration) return true
    if (maximumPublicationRevision !== undefined) {
      const publicationRevision = getInteger(registration, NZ_PUBLICATION_REVISION)
      if (publicationRevision !== null && publicationRevision > maximumPublicationRevision) {
        return false
      }
    }
    await saveSolidDatasetWithPatchFallback(
      publicTypeIndexUrl,
      removeThing(dataset, registrationUrl),
      this.session.fetch,
      snapshot.etag,
      {
        'x-nodezero-publication-revision': String(maximumPublicationRevision ?? 0),
      }
    )
    return true
  }

  async listRegistrations(
    publicTypeIndexUrl: string,
    options: { requirePublicIndexTypes?: boolean } = {}
  ): Promise<PublicTypeRegistration[]> {
    const dataset = (await getSolidDatasetSnapshot(publicTypeIndexUrl, this.session.fetch)).dataset
    const indexThing = getThing(dataset, publicTypeIndexUrl)
    const indexTypes = indexThing ? getUrlAll(indexThing, RDF_TYPE) : []
    if (
      options.requirePublicIndexTypes &&
      (!indexTypes.includes(SOLID_TYPE_INDEX) || !indexTypes.includes(SOLID_LISTED_DOCUMENT))
    ) {
      throw new Error('The public Type Index document is missing its required Solid types.')
    }
    const registrations: PublicTypeRegistration[] = []
    for (const thing of getThingAll(dataset)) {
      if (getUrl(thing, RDF_TYPE) !== SOLID_TYPE_REGISTRATION) continue
      const forClass = getUrl(thing, SOLID_FOR_CLASS)
      const instance = getUrl(thing, SOLID_INSTANCE)
      const publicationRevision = getInteger(thing, NZ_PUBLICATION_REVISION)
      if (forClass && instance) {
        registrations.push({
          forClass,
          instance,
          ...(publicationRevision !== null ? { publicationRevision } : {}),
        })
      }
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
