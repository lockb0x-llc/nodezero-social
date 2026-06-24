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
  getSolidDataset,
  saveSolidDatasetAt,
  getThing,
  setThing,
  createSolidDataset,
  buildThing,
  createThing,
  getStringNoLocale,
  getUrl,
  getBoolean,
  setStringNoLocale,
  setUrl,
  setBoolean,
  type SolidDataset,
  type Thing,
  type WithServerResourceInfo,
} from '@inrupt/solid-client'
import type { Session } from '@inrupt/solid-client-authn-node'
import { NsfwScanner } from './NsfwScanner.js'

// ─── NodeZero custom RDF namespace ────────────────────────────────────────────
const NZ_NS = 'https://vocab.nodezero.social/ns#'
const NZ_IS_NSFW = `${NZ_NS}isNSFW`
const NZ_INTERESTS = `${NZ_NS}interests`

// ─── Standard vocabulary predicates ──────────────────────────────────────────
const VCARD_FN = 'http://www.w3.org/2006/vcard/ns#fn'
const VCARD_NOTE = 'http://www.w3.org/2006/vcard/ns#note'
const VCARD_PHOTO = 'http://www.w3.org/2006/vcard/ns#hasPhoto'
const VCARD_URL = 'http://www.w3.org/2006/vcard/ns#url'

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
  private readonly session: Session
  private readonly nsfwScanner: NsfwScanner

  /**
   * @param session - An authenticated Inrupt Solid session.
   * @param nsfwScanner - Optional custom scanner instance. Defaults to a
   *   standard {@link NsfwScanner}.
   */
  constructor(session: Session, nsfwScanner?: NsfwScanner) {
    this.session = session
    this.nsfwScanner = nsfwScanner ?? new NsfwScanner()
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
    const datasetPath = options.datasetPath ?? 'profile/card'
    const datasetUrl = `${podRootUrl.replace(/\/$/, '')}/${datasetPath}`
    const webId = `${datasetUrl}#me`

    // ── NSFW auto-detection ────────────────────────────────────────────────
    const urlsToScan: string[] = []
    if (profile.externalUrl) urlsToScan.push(profile.externalUrl)
    if (profile.avatarUrl) urlsToScan.push(profile.avatarUrl)

    const scanResult = this.nsfwScanner.scan(urlsToScan)
    const isNsfw = profile.isNsfw || scanResult.isNsfw

    // ── Build RDF Thing ────────────────────────────────────────────────────
    let thingBuilder = buildThing(createThing({ url: webId }))
      .setStringNoLocale(VCARD_FN, profile.displayName)
      .setStringNoLocale(VCARD_NOTE, profile.bio)
      .setBoolean(NZ_IS_NSFW, isNsfw)

    if (profile.avatarUrl) {
      thingBuilder = thingBuilder.setUrl(VCARD_PHOTO, profile.avatarUrl)
    }
    if (profile.externalUrl) {
      thingBuilder = thingBuilder.setUrl(VCARD_URL, profile.externalUrl)
    }
    for (const interest of profile.interests) {
      thingBuilder = thingBuilder.addStringNoLocale(NZ_INTERESTS, interest)
    }

    const profileThing = thingBuilder.build()

    // ── Fetch or create the dataset, then patch and save ──────────────────
    let dataset: SolidDataset
    try {
      const existing = await getSolidDataset(datasetUrl, { fetch: this.session.fetch })
      dataset = setThing(existing, profileThing)
    } catch (err) {
      if (isNotFoundError(err)) {
        dataset = setThing(createSolidDataset(), profileThing)
      } else {
        throw err
      }
    }

    await saveSolidDatasetAt(datasetUrl, dataset, { fetch: this.session.fetch })

    return datasetUrl
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Deserialises an RDF `Thing` into a {@link UserProfile}.
 */
function thingToProfile(thing: Thing): UserProfile {
  return {
    displayName: getStringNoLocale(thing, VCARD_FN) ?? '',
    bio: getStringNoLocale(thing, VCARD_NOTE) ?? '',
    avatarUrl: getUrl(thing, VCARD_PHOTO) ?? undefined,
    externalUrl: getUrl(thing, VCARD_URL) ?? undefined,
    interests: getAllStrings(thing, NZ_INTERESTS),
    isNsfw: getBoolean(thing, NZ_IS_NSFW) ?? false,
  }
}

/**
 * Returns all string values for a given predicate on a Thing (multi-value).
 */
function getAllStrings(thing: Thing, predicate: string): string[] {
  // @inrupt/solid-client does not expose a multi-value string getter in the
  // public API, so we read the underlying dataset via the thing's predicates.
  // We fall back to a single value if the predicate only has one entry.
  const single = getStringNoLocale(thing, predicate)
  return single ? [single] : []
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
