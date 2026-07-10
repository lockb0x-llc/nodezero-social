/**
 * @module SocialGraph
 *
 * Manages the social graph (connections / follows) for a NodeZero user.
 *
 * Connections are modelled using the standard FOAF vocabulary:
 * `http://xmlns.com/foaf/0.1/knows` – semantically "this person knows X".
 *
 * Data is stored in the user's Solid Pod under `social/connections`, keeping
 * it separate from the profile card. The user retains full ownership and can
 * revoke access or delete the dataset at any time.
 */

import {
  getSolidDataset,
  saveSolidDatasetAt,
  getThing,
  setThing,
  removeThing,
  createSolidDataset,
  buildThing,
  createThing,
  getUrlAll,
  getThingAll,
  type SolidDataset,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'
import { assertValidConnectionRecord } from './contracts/SocialGraphContract.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

// ─── Session interface ────────────────────────────────────────────────────────
/** Minimal authenticated session interface – structurally compatible with
 * `@inrupt/solid-client-authn-node` Session without requiring it as a direct dep. */
interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

// ─── Vocabulary constants ─────────────────────────────────────────────────────
const FOAF_KNOWS = 'http://xmlns.com/foaf/0.1/knows'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const FOAF_PERSON = 'http://xmlns.com/foaf/0.1/Person'

export function intersectInterests(localInterests: string[], peerInterests: Iterable<string>): string[] {
  const peerSet = new Set(peerInterests)
  return localInterests.filter((interest) => peerSet.has(interest))
}

/** Represents a connection (follow relationship) in the social graph. */
export interface Connection {
  /** The WebID of the connected user. */
  webId: string
}

export interface SocialGraphOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: Pick<PodLayoutManager, 'ensureDefaultLayoutAndPolicies'>
}

/**
 * Manages follow/unfollow operations against the user's Solid Pod.
 *
 * @example
 * ```ts
 * const graph = new SocialGraph(session)
 *
 * // Follow Alice:
 * await graph.addConnection('https://myPod.example.com/', 'https://alice.solidcommunity.net/profile/card#me')
 *
 * // List all connections:
 * const connections = await graph.listConnections('https://myPod.example.com/')
 *
 * // Unfollow Alice:
 * await graph.removeConnection('https://myPod.example.com/', 'https://alice.solidcommunity.net/profile/card#me')
 * ```
 */
export class SocialGraph {
  private readonly session: AuthenticatedSession
  private readonly options: SocialGraphOptions

  constructor(session: AuthenticatedSession, options: SocialGraphOptions = {}) {
    this.session = session
    this.options = options
  }

  /**
   * Returns all `foaf:knows` connections stored in the user's Pod.
   *
   * @param podRootUrl - Root URL of the user's Pod.
   * @returns Array of {@link Connection} objects, or an empty array when none exist.
   */
  async listConnections(podRootUrl: string): Promise<Connection[]> {
    const datasetUrl = this.connectionsUrl(podRootUrl)
    const canonicalOwnerWebId = this.ownerWebId(podRootUrl)
    const legacyOwnerWebId = `${datasetUrl}#me`

    let dataset: SolidDataset & WithServerResourceInfo

    try {
      dataset = await getSolidDataset(datasetUrl, { fetch: this.session.fetch })
    } catch {
      // No connections dataset yet – return empty list.
      return []
    }

    const ownerThing =
      getThing(dataset, canonicalOwnerWebId) ??
      getThing(dataset, legacyOwnerWebId)

    if (ownerThing) {
      return getUrlAll(ownerThing, FOAF_KNOWS).map((webId) => ({ webId }))
    }

    // Fallback for dataset URL normalization differences across Solid servers.
    const knows = new Set<string>()
    for (const thing of getThingAll(dataset)) {
      for (const webId of getUrlAll(thing, FOAF_KNOWS)) {
        knows.add(webId)
      }
    }

    return Array.from(knows).map((webId) => ({ webId }))
  }

  /**
   * Adds a `foaf:knows` triple to the user's social graph.
   *
   * Idempotent – calling this multiple times with the same target WebID is safe.
   *
   * @param podRootUrl - Root URL of the user's Pod.
   * @param targetWebId - WebID of the user to follow.
   * @returns The URL of the updated dataset.
   */
  async addConnection(podRootUrl: string, targetWebId: string): Promise<string> {
    assertValidConnectionRecord({ webId: targetWebId })
    await this.ensurePodLayoutIfEnabled(podRootUrl)

    const datasetUrl = this.connectionsUrl(podRootUrl)
    const ownerWebId = this.ownerWebId(podRootUrl)
    const legacyOwnerWebId = `${datasetUrl}#me`

    const dataset = await this.getOrCreateDataset(datasetUrl)
    const existing = getThing(dataset, ownerWebId) ?? getThing(dataset, legacyOwnerWebId)

    // Build updated thing – preserve existing `foaf:knows` entries.
    const existingUrls = existing ? getUrlAll(existing, FOAF_KNOWS) : []
    const allUrls = Array.from(new Set([...existingUrls, targetWebId]))

    let thingBuilder = buildThing(createThing({ url: ownerWebId })).setUrl(
      RDF_TYPE,
      FOAF_PERSON
    )
    for (const url of allUrls) {
      thingBuilder = thingBuilder.addUrl(FOAF_KNOWS, url)
    }

    let updated = setThing(dataset, thingBuilder.build())
    if (legacyOwnerWebId !== ownerWebId) {
      updated = removeThing(updated, legacyOwnerWebId)
    }

    await saveSolidDatasetAt(datasetUrl, updated, { fetch: this.session.fetch })

    return datasetUrl
  }

  /**
   * Removes a `foaf:knows` triple from the user's social graph.
   *
   * Idempotent – if the connection does not exist this is a no-op.
   *
   * @param podRootUrl - Root URL of the user's Pod.
   * @param targetWebId - WebID of the user to unfollow.
   * @returns The URL of the updated dataset.
   */
  async removeConnection(podRootUrl: string, targetWebId: string): Promise<string> {
    assertValidConnectionRecord({ webId: targetWebId })
    await this.ensurePodLayoutIfEnabled(podRootUrl)

    const datasetUrl = this.connectionsUrl(podRootUrl)
    const ownerWebId = this.ownerWebId(podRootUrl)
    const legacyOwnerWebId = `${datasetUrl}#me`

    let dataset: SolidDataset & WithServerResourceInfo

    try {
      dataset = await getSolidDataset(datasetUrl, { fetch: this.session.fetch })
    } catch {
      // No dataset – nothing to remove.
      return datasetUrl
    }

    const existing = getThing(dataset, ownerWebId) ?? getThing(dataset, legacyOwnerWebId)
    if (!existing) return datasetUrl

    const remainingUrls = getUrlAll(existing, FOAF_KNOWS).filter((u) => u !== targetWebId)

    if (remainingUrls.length === 0) {
      // Remove the whole thing if no connections remain.
      let stripped = removeThing(dataset, ownerWebId)
      if (legacyOwnerWebId !== ownerWebId) {
        stripped = removeThing(stripped, legacyOwnerWebId)
      }
      await saveSolidDatasetAt(datasetUrl, stripped, { fetch: this.session.fetch })
      return datasetUrl
    }

    let thingBuilder = buildThing(createThing({ url: ownerWebId })).setUrl(
      RDF_TYPE,
      FOAF_PERSON
    )
    for (const url of remainingUrls) {
      thingBuilder = thingBuilder.addUrl(FOAF_KNOWS, url)
    }

    let updated = setThing(dataset, thingBuilder.build())
    if (legacyOwnerWebId !== ownerWebId) {
      updated = removeThing(updated, legacyOwnerWebId)
    }

    await saveSolidDatasetAt(datasetUrl, updated, { fetch: this.session.fetch })

    return datasetUrl
  }

  private connectionsUrl(podRootUrl: string): string {
    return `${podRootUrl.replace(/\/$/, '')}/social/connections`
  }

  private ownerWebId(podRootUrl: string): string {
    return `${podRootUrl.replace(/\/$/, '')}/profile/card#me`
  }

  private async getOrCreateDataset(
    datasetUrl: string
  ): Promise<SolidDataset & Partial<WithServerResourceInfo>> {
    try {
      return await getSolidDataset(datasetUrl, { fetch: this.session.fetch })
    } catch {
      return createSolidDataset()
    }
  }

  /**
   * Compares the peer's public interests to the local user's interests and
   * returns the intersection.
   *
   * Looks for `schema:interest` and `foaf:topic_interest` predicate values on
   * the peer's public profile. The local interests list defaults to an empty
   * array until profile-loading is wired in a later phase.
   *
   * @param peerWebId - The peer's WebID URL.
   * @returns String array of overlapping interest values, or `[]` on any error.
   */
  async findSemanticOverlap(peerWebId: string, localInterests: string[] = []): Promise<string[]> {
    const SCHEMA_INTEREST = 'https://schema.org/interest'
    const FOAF_TOPIC_INTEREST = 'http://xmlns.com/foaf/0.1/topic_interest'

    let dataset: SolidDataset & WithServerResourceInfo

    try {
      const profileUrl = peerWebId.split('#')[0]
      dataset = await getSolidDataset(profileUrl, { fetch: this.session.fetch })
    } catch {
      return []
    }

    try {
      const thing = getThing(dataset, peerWebId)
      if (!thing) return []

      const peerInterests = new Set([
        ...getUrlAll(thing, SCHEMA_INTEREST),
        ...getUrlAll(thing, FOAF_TOPIC_INTEREST),
      ])

      if (localInterests.length === 0 || peerInterests.size === 0) return []

      return intersectInterests(localInterests, peerInterests)
    } catch {
      return []
    }
  }

  private async ensurePodLayoutIfEnabled(podRoot: string): Promise<void> {
    if (!this.options.enablePodBootstrap) return

    const podLayoutManager =
      this.options.podLayoutManager ?? new PodLayoutManager({ fetch: this.session.fetch })

    await podLayoutManager.ensureDefaultLayoutAndPolicies(
      podRoot,
      this.options.policyMatrix ?? DEFAULT_POLICY_MATRIX
    )
  }
}
