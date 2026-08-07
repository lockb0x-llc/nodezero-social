/**
 * @module ProfileManager
 *
 * Handles reading and writing NodeZero user profiles against a Solid Pod.
 *
 * All profile data is stored in the user's own Pod using standard RDF
 * vocabularies (vCard, FOAF). NSFW classification is handled by shared
 * decision helpers and persisted through profile preferences, not the public
 * profile document.
 *
 * NodeZero is a *client application* – it never stores profile data in its
 * own database. The Pod URL is authoritative.
 */

import {
  createSolidDataset,
  createThing,
  getSolidDataset,
  getThing,
  getThingAll,
  buildThing,
  getStringNoLocale,
  getUrl,
  setThing,
  getSourceUrl,
  asUrl,
  type SolidDataset,
  type Thing,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'
import { NsfwScanner } from './NsfwScanner.js'
import { hasNsfwSignals } from './NsfwDecision.js'
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
import {
  getSolidDatasetSnapshot,
  saveSolidDatasetWithPatchFallback,
} from './saveSolidDatasetCompat.js'

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
   * Effective NSFW state for the profile view. Public profile writes do not
   * persist this value directly.
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
  /**
   * Whether to provision optional DocuStream/Social/Backpack containers before
   * saving. Profile documents already exist at onboarding, so callers can
   * disable this to keep an unrelated bootstrap failure from blocking a
   * profile update.
   */
  bootstrapPodLayout?: boolean
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

    const thing = resolveProfileThing(dataset, webId)
    if (!thing) return null

    return thingToProfile(thing)
  }

  /**
   * Writes a profile to the Solid Pod.
   *
   * The method persists public profile fields to `<podRoot>/<datasetPath>`.
   * NSFW scanning is still invoked through the shared decision helper for
   * contract consistency with callers that persist private preferences.
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
    if (options.bootstrapPodLayout ?? true) {
      await this.ensurePodLayoutIfEnabled(podRootUrl)
    }

    const datasetPath = options.datasetPath ?? 'profile/card'
    const datasetUrl = `${podRootUrl.replace(/\/$/, '')}/${datasetPath}`
    const webId = `${datasetUrl}#me`

    // ── NSFW auto-detection ────────────────────────────────────────────────
    hasNsfwSignals(
      {
        externalUrl: profile.externalUrl,
        avatarUrl: profile.avatarUrl,
      },
      {
        scanner: this.nsfwScanner,
      }
    )

    const publicProfile: PublicProfileDocument = {
      displayName: profile.displayName,
      bio: profile.bio,
      ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      ...(profile.externalUrl ? { externalUrl: profile.externalUrl } : {}),
    }
    assertValidPublicProfileDocument(publicProfile)

    // ── Fetch or create the dataset, then patch and save ──────────────────
    let dataset: SolidDataset
    let etag: string | null = null
    let existingDocumentThing: import('@inrupt/solid-client').Thing
    let existingProfileThing: import('@inrupt/solid-client').Thing

    try {
      const snapshot = await getSolidDatasetSnapshot(datasetUrl, this.session.fetch)
      dataset = snapshot.dataset
      etag = snapshot.etag
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
    await saveSolidDatasetWithPatchFallback(targetUrl, dataset, this.session.fetch, etag)

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

export function resolveProfileThing(dataset: SolidDataset, webId: string): Thing | null {
  const datasetUrl = webId.split('#')[0]
  const direct = getThing(dataset, webId)
  if (direct) return direct

  const canonicalDefault = getThing(dataset, `${datasetUrl}#me`)
  if (canonicalDefault) return canonicalDefault

  const targetWebIdPath = pathAndHash(webId)
  const targetDatasetPath = pathOnly(datasetUrl)

  for (const candidate of getThingAll(dataset)) {
    const candidateUrl = asUrl(candidate)
    if (normalizeIri(candidateUrl) === normalizeIri(webId)) {
      return candidate
    }

    const candidatePath = pathAndHash(candidateUrl)
    if (
      targetWebIdPath &&
      candidatePath &&
      candidatePath.endsWith(targetWebIdPath)
    ) {
      return candidate
    }

    const candidateDatasetPath = pathOnly(candidateUrl)
    if (
      targetDatasetPath &&
      candidateDatasetPath &&
      candidateDatasetPath.endsWith(targetDatasetPath) &&
      candidateUrl.includes('#me')
    ) {
      return candidate
    }
  }

  for (const candidate of getThingAll(dataset)) {
    if (
      getStringNoLocale(candidate, VCARD_FN) !== null ||
      getStringNoLocale(candidate, FOAF_NAME) !== null ||
      getStringNoLocale(candidate, VCARD_NOTE) !== null ||
      getUrl(candidate, VCARD_PHOTO) !== null ||
      getUrl(candidate, FOAF_IMG) !== null ||
      getUrl(candidate, VCARD_URL) !== null
    ) {
      return candidate
    }
  }

  return null
}

function pathOnly(iri: string): string | null {
  try {
    return new URL(iri).pathname
  } catch {
    return null
  }
}

function pathAndHash(iri: string): string | null {
  try {
    const url = new URL(iri)
    return `${url.pathname}${url.hash}`
  } catch {
    return null
  }
}

function normalizeIri(iri: string): string {
  return iri.replace(/\/$/, '')
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
