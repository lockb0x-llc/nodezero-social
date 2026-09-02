/**
 * Deterministic feed ranking weights.
 *
 * NodeZero does not rank by engagement. There are no likes, dwell times, or
 * probabilistic scores. Ranking is a bounded, explainable shift on top of a strictly
 * chronological timeline: a boosted post surfaces *as if it were published up to N hours
 * more recently*. The same inputs always produce the same order.
 *
 * At slider value 0 the output is byte-for-byte the chronological order, so the default
 * behaviour is unchanged and the controls are strictly opt-in.
 */

export interface RankableFeedPost {
  id: string
  authorWebId: string
  createdAt: string
}

export interface FeedRankingInput {
  /** 0-100. Boosts authors in the viewer's Trust Circle. */
  deepTies: number
  /** 0-100. Boosts accepted connections outside the Trust Circle. */
  serendipity: number
  trustCircleWebIds: readonly string[]
  /** The viewer's own WebID. Own posts are never boosted. */
  ownerWebId?: string | undefined
}

/** A Trust Circle post may surface as if up to this many hours newer. */
export const TRUST_CIRCLE_MAX_BOOST_HOURS = 12
/** A non-Trust-Circle connection's post may surface as if up to this many hours newer. */
export const WIDER_NETWORK_MAX_BOOST_HOURS = 6

const MS_PER_HOUR = 3_600_000

function clampSlider(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value)) / 100
}

/**
 * Returns the boost in milliseconds applied to a post, before it is added to the
 * post's timestamp. Exported so the UI can explain the active weighting.
 */
export function boostMsForAuthor(
  authorWebId: string,
  input: FeedRankingInput
): number {
  if (input.ownerWebId && authorWebId === input.ownerWebId) return 0

  if (input.trustCircleWebIds.includes(authorWebId)) {
    return clampSlider(input.deepTies) * TRUST_CIRCLE_MAX_BOOST_HOURS * MS_PER_HOUR
  }
  return clampSlider(input.serendipity) * WIDER_NETWORK_MAX_BOOST_HOURS * MS_PER_HOUR
}

/**
 * Orders posts newest-first after applying deterministic author boosts.
 *
 * Ties are broken by post id so the ordering is stable across renders and devices.
 * Posts with an unparseable timestamp sort last rather than being dropped.
 */
export function rankFeedPosts<T extends RankableFeedPost>(
  posts: readonly T[],
  input: FeedRankingInput
): T[] {
  const scored = posts.map((post) => {
    const parsed = Date.parse(post.createdAt)
    const base = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
    const effective =
      base === Number.NEGATIVE_INFINITY ? base : base + boostMsForAuthor(post.authorWebId, input)
    return { post, effective }
  })

  scored.sort((a, b) => {
    if (a.effective !== b.effective) return b.effective - a.effective
    return a.post.id < b.post.id ? -1 : a.post.id > b.post.id ? 1 : 0
  })

  return scored.map((entry) => entry.post)
}
