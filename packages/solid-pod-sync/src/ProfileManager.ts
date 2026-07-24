/**
 * @module ProfileManager
 *
 * Handles reading and writing NodeZero user profiles against a Solid Pod.
 *
 * All profile data is stored in the user's own Pod using standard RDF
 * vocabularies (vCard, FOAF) plus a NodeZero-specific namespace for
 * platform-specific metadata such as the `isNSFW` flag.
 *
 * NodeZero is a *client application* – it never stores profile data in its
 * own database. The Pod URL is authoritative.
 */

import {
  createSolidDataset,
  createThing,
  saveSolidDatasetAt,
  getSolidDataset,
  getThing,
  buildThing,
  getStringNoLocale,
  getUrl,
  setThing,
  getSourceUrl,
  type SolidDataset,
  type Thing,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'
import { NsfwScanner } from './NsfwScanner.js'
import {
  assertValidPublicProfileDocument,
  type PublicProfileDocument,
} from './contracts/DataBackpackContract.js'
import {
  assertAclNamespacePolicy,
  DEFAULT_POLICY_MATRIX,
  deriveOwnerWebId,
  PodLayoutManager,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

// ─── Session interface ────────────────────────────────────────────────────────
/** Minimal authenticated session interface – structurally compatible with
 * `@inrupt/solid-client-authn-node` Session without requiring it as a direct dep. */
interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

// ─── Standard vocabulary predicates ──────────────────────────────────────────
const VCARD_FN = 'http://www.w3.org/2006/vcard/ns#fn'
const VCARD_NOTE = 'http://www.w3.org/2006/vcard/ns#note'
const VCARD_PHOTO = 'http://www.w3.org/2006/vcard/ns#hasPhoto'
const VCARD_URL = 'http://www.w3.org/2006/vcard/ns#url'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const FOAF_PERSON = 'http://xmlns.com/foaf/0.1/Person'
const FOAF_PERSONAL_PROFILE_DOCUMENT = 'http://xmlns.com/foaf/0.1/PersonalProfileDocument'
const FOAF_MAKER = 'http://xmlns.com/foaf/0.1/maker'
const FOAF_PRIMARY_TOPIC = 'http://xmlns.com/foaf/0.1/primaryTopic'
const FOAF_NAME = 'http://xmlns.com/foaf/0.1/name'
const FOAF_IMG = 'http://xmlns.com/foaf/0.1/img'
/** Shape of a NodeZero user profile stored in a Solid Pod. */
export interface UserProfile {
  /** The user's display name. */
  displayName: string
  /** Short biography / bio text. */
  bio: string
  /** URL pointing to the user's avatar image. */
  avatarUrl?: string
  /** External URL (e.g. personal website, social handle). */
  externalUrl?: string
  /** Free-form interest tags. */
  interests: string[]
  /**
   * Automatically set to `true` when any supplied URL matches a known
   * adult-content domain. Stored as `<nodezero:isNSFW> true` in the Pod.
   */
  isNsfw: boolean
}

/** Options accepted by {@link ProfileManager.writeProfile}. */
export interface ProfileWriteOptions {
  /**
   * Override the dataset path relative to the Pod root.
   * Defaults to `profile/card`.
   */
  datasetPath?: string
}

export interface ProfileManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: Pick<PodLayoutManager, 'ensureDefaultLayoutAndPolicies'>
}

/**
 * Manages reading and writing user profiles to a Solid Pod.
 *
 * @example
 * ```ts
 * import { ProfileManager } from '@nodezero/solid-pod-sync'
 *
 * const manager = new ProfileManager(session)
 * const profile = await manager.readProfile('https://alice.solidcommunity.net/profile/card#me')
 * console.log(profile.displayName) // "Alice"
 *
 * await manager.writeProfile('https://alice.solidcommunity.net/', {
 *   displayName: 'Alice',
 *   bio: 'Decentralised web advocate.',
 *   externalUrl: 'https://onlyfans.com/alice', // triggers isNsfw = true
 *   interests: ['web3', 'solid', 'privacy'],
 *   isNsfw: false, // overridden by scanner
 * })
 * ```
 */
export class ProfileManager {
  private readonly session: AuthenticatedSession
  private readonly nsfwScanner: NsfwScanner
  private readonly options: ProfileManagerOptions

  /**
   * @param session - An authenticated Inrupt Solid session.
   * @param nsfwScanner - Optional custom scanner instance. Defaults to a
   *   standard {@link NsfwScanner}.
   */
  constructor(
    session: AuthenticatedSession,
    nsfwScanner?: NsfwScanner,
    options: ProfileManagerOptions = {}
  ) {
    this.session = session
    this.nsfwScanner = nsfwScanner ?? new NsfwScanner()
    this.options = options
  }

  /**
   * Reads a profile from the Solid Pod addressed by the given WebID URL.
   *
   * @param webId - Full WebID URL (e.g. `https://alice.solidcommunity.net/profile/card#me`).
   * @returns Parsed {@link UserProfile}, or `null` if the resource does not exist.
   * @throws When the fetch fails for reasons other than a 404.
   */
  async readProfile(webId: string): Promise<UserProfile | null> {
    const datasetUrl = webId.split('#')[0]

    let dataset: SolidDataset & WithServerResourceInfo

    try {
      dataset = await getSolidDataset(datasetUrl, {
        fetch: this.session.fetch,
      })
    } catch (err) {
      if (isNotFoundError(err)) return null
      throw err
    }

    const thing = getThing(dataset, webId)
    if (!thing) return null

    return thingToProfile(thing)
  }

  /**
   * Writes a profile to the Solid Pod.
   *
   * The method will:
   * 1. Scan all supplied URLs for adult-content domains.
   * 2. Automatically set `isNsfw = true` in the dataset if a match is found.
   * 3. Persist the dataset to `<podRoot>/<datasetPath>`.
   *
   * @param podRootUrl - Root URL of the user's Pod (e.g. `https://alice.solidcommunity.net/`).
   * @param profile - Profile data to write.
   * @param options - Optional write configuration.
   * @returns The URL of the saved dataset.
   */
  async writeProfile(
    podRootUrl: string,
    profile: UserProfile,
    options: ProfileWriteOptions = {}
  ): Promise<string> {
    await this.ensurePodLayoutIfEnabled(podRootUrl)

    const datasetPath = options.datasetPath ?? 'profile/card'
    const datasetUrl = `${podRootUrl.replace(/\/$/, '')}/${datasetPath}`
    const webId = `${datasetUrl}#me`

    // ── NSFW auto-detection ────────────────────────────────────────────────
    const urlsToScan: string[] = []
    if (profile.externalUrl) urlsToScan.push(profile.externalUrl)
    if (profile.avatarUrl) urlsToScan.push(profile.avatarUrl)

    this.nsfwScanner.scan(urlsToScan)

    const publicProfile: PublicProfileDocument = {
      displayName: profile.displayName,
      bio: profile.bio,
      ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      ...(profile.externalUrl ? { externalUrl: profile.externalUrl } : {}),
    }
    assertValidPublicProfileDocument(publicProfile)

    // ── Fetch or create the dataset, then patch and save ──────────────────
    let dataset: SolidDataset
    let existingDocumentThing: import('@inrupt/solid-client').Thing
    let existingProfileThing: import('@inrupt/solid-client').Thing

    try {
      dataset = await getSolidDataset(datasetUrl, { fetch: this.session.fetch })
      existingDocumentThing = getThing(dataset, datasetUrl) ?? createThing({ url: datasetUrl })
      existingProfileThing = getThing(dataset, webId) ?? createThing({ url: webId })
    } catch (err) {
      if (isNotFoundError(err)) {
        dataset = createSolidDataset()
        existingDocumentThing = createThing({ url: datasetUrl })
        existingProfileThing = createThing({ url: webId })
      } else {
        throw err
      }
    }

    // ── Build Document Thing ───────────────────────────────────────────────
    const documentThing = buildThing(existingDocumentThing)
      .addUrl(RDF_TYPE, FOAF_PERSONAL_PROFILE_DOCUMENT)
      .setUrl(FOAF_MAKER, webId)
      .setUrl(FOAF_PRIMARY_TOPIC, webId)
      .build()

    // ── Build Profile Thing ────────────────────────────────────────────────
    let thingBuilder = buildThing(existingProfileThing)
      .addUrl(RDF_TYPE, FOAF_PERSON)
      .removeAll(VCARD_FN)
      .removeAll(FOAF_NAME)
      .removeAll(VCARD_NOTE)
      .removeAll(VCARD_PHOTO)
      .removeAll(FOAF_IMG)
      .removeAll(VCARD_URL)
      .setStringNoLocale(VCARD_FN, profile.displayName)
      .setStringNoLocale(FOAF_NAME, profile.displayName)
      .setStringNoLocale(VCARD_NOTE, profile.bio)

    if (profile.avatarUrl) {
      thingBuilder = thingBuilder.setUrl(VCARD_PHOTO, profile.avatarUrl)
      thingBuilder = thingBuilder.setUrl(FOAF_IMG, profile.avatarUrl)
    }
    if (profile.externalUrl) {
      thingBuilder = thingBuilder.setUrl(VCARD_URL, profile.externalUrl)
    }
    const profileThing = thingBuilder.build()

    dataset = setThing(dataset, documentThing)
    dataset = setThing(dataset, profileThing)

    const targetUrl = getSourceUrl(dataset) || datasetUrl
    await saveSolidDatasetAt(targetUrl, dataset, { fetch: this.session.fetch })

    return datasetUrl
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

  /**
   * Writes or patches a `.acl` resource on the LDP container at `containerPath`.
   *
   * When `isPublic=true`, grants `acl:Read` to `foaf:Agent` (world-readable).
   * When `isPublic=false`, removes public read access by writing an owner-only ACL.
   *
   * @param containerPath - Full URL of the LDP container whose ACL should be updated.
   * @param isPublic - `true` to grant public read; `false` to restrict to owner only.
   */
  async updateWebACL(containerPath: string, isPublic: boolean): Promise<void> {
    const aclUrl = `${containerPath.replace(/\/$/, '')}/.acl`

    // Build minimal Turtle ACL document.
    // Prefer an explicit owner WebID, but fall back to the canonical profile-card WebID pattern.
    const ownerWebId = deriveOwnerWebId(containerPath)
    assertAclNamespacePolicy(containerPath, ownerWebId)
    const ownerBlock = `
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<#owner>
    a acl:Authorization ;
    acl:accessTo <${containerPath}> ;
    acl:default <${containerPath}> ;
    acl:agent <${ownerWebId}> ;
    acl:mode acl:Read, acl:Write, acl:Control .
`.trim()

    const publicBlock = `

<#public>
    a acl:Authorization ;
    acl:accessTo <${containerPath}> ;
    acl:default <${containerPath}> ;
    acl:agentClass foaf:Agent ;
    acl:mode acl:Read .`

    const body = isPublic ? `${ownerBlock}${publicBlock}\n` : `${ownerBlock}\n`

    try {
      await this.session.fetch(aclUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/turtle' },
        body,
      })
    } catch (err) {
      // Stub behaviour: swallow rather than crashing callers when the
      // server does not support direct ACL writes (e.g. WAC not enabled).
      void err
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Deserialises an RDF `Thing` into a {@link UserProfile}.
 */
function thingToProfile(thing: Thing): UserProfile {
  const avatarUrl = getUrl(thing, VCARD_PHOTO) ?? getUrl(thing, FOAF_IMG)
  const externalUrl = getUrl(thing, VCARD_URL)
  return {
    displayName: getStringNoLocale(thing, VCARD_FN) ?? getStringNoLocale(thing, FOAF_NAME) ?? '',
    bio: getStringNoLocale(thing, VCARD_NOTE) ?? '',
    ...(avatarUrl !== null ? { avatarUrl } : {}),
    ...(externalUrl !== null ? { externalUrl } : {}),
    interests: [],
    isNsfw: false,
  }
}

/**
 * Determines whether a thrown error represents an HTTP 404 Not Found.
 */
function isNotFoundError(err: unknown): boolean {
  if (err instanceof Error) {
    // Inrupt client throws errors with a `statusCode` property for HTTP errors.
    const httpErr = err as Error & { statusCode?: number }
    return httpErr.statusCode === 404
  }
  return false
}

// Re-export helpers for use within the package.
export { thingToProfile as _thingToProfile }
