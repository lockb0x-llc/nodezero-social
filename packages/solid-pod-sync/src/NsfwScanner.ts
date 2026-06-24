/**
 * @module NsfwScanner
 *
 * Scans URLs embedded in user-supplied profile data against a curated list of
 * adult-content domains. When a match is found, the scanner returns a flag so
 * that the caller (ProfileManager) can annotate the Solid Pod dataset with the
 * custom RDF predicate `<https://vocab.nodezero.social/ns#isNSFW> true`.
 *
 * NodeZero Philosophy on NSFW:
 * - We do NOT penalise or ban users for legal adult content.
 * - Detection is done client-side. The flag is stored in the user's own Pod.
 * - The UI layer decides how to render flagged content; the network is neutral.
 */

/** Canonical list of adult-content domains that trigger the NSFW flag. */
export const NSFW_DOMAINS: ReadonlyArray<string> = [
  'onlyfans.com',
  'fansly.com',
  'pornhub.com',
  'manyvids.com',
  'clips4sale.com',
  'justforfans.com',
] as const

/** Shape of the result returned by {@link NsfwScanner.scan}. */
export interface NsfwScanResult {
  /** Whether any of the supplied URLs matched a known adult-content domain. */
  isNsfw: boolean
  /** The subset of URLs that triggered the NSFW flag. */
  matchedUrls: string[]
}

/**
 * Utility class for detecting adult-content URLs before writing data to a
 * user's Solid Pod. Instantiate with an optional custom domain list to extend
 * or override the default {@link NSFW_DOMAINS}.
 *
 * @example
 * ```ts
 * const scanner = new NsfwScanner()
 * const result = scanner.scan(['https://onlyfans.com/myprofile', 'https://example.com'])
 * // result.isNsfw  → true
 * // result.matchedUrls → ['https://onlyfans.com/myprofile']
 * ```
 */
export class NsfwScanner {
  private readonly domains: ReadonlyArray<string>

  /**
   * @param extraDomains - Additional domains to append to the default list.
   *   Pass an empty array to keep only the defaults.
   */
  constructor(extraDomains: string[] = []) {
    this.domains = [...NSFW_DOMAINS, ...extraDomains.map((d) => d.toLowerCase())]
  }

  /**
   * Scans an array of URL strings and returns a result indicating whether any
   * match a known adult-content domain.
   *
   * @param urls - Array of URL strings to inspect.
   * @returns {@link NsfwScanResult}
   */
  scan(urls: string[]): NsfwScanResult {
    const matchedUrls: string[] = []

    for (const raw of urls) {
      if (this.matchesDomain(raw)) {
        matchedUrls.push(raw)
      }
    }

    return {
      isNsfw: matchedUrls.length > 0,
      matchedUrls,
    }
  }

  /**
   * Tests a single URL string against the domain list.
   *
   * @param url - Raw URL string (may be malformed – handled gracefully).
   * @returns `true` if the URL's hostname matches any known NSFW domain.
   */
  private matchesDomain(url: string): boolean {
    try {
      const { hostname } = new URL(url)
      const normalised = hostname.toLowerCase().replace(/^www\./, '')
      return this.domains.some(
        (domain) => normalised === domain || normalised.endsWith(`.${domain}`)
      )
    } catch {
      // Malformed URLs are ignored – they cannot match any domain.
      return false
    }
  }
}
