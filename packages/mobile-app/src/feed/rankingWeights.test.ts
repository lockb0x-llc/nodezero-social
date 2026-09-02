import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  boostMsForAuthor,
  rankFeedPosts,
  TRUST_CIRCLE_MAX_BOOST_HOURS,
  WIDER_NETWORK_MAX_BOOST_HOURS,
} from './rankingWeights'

const owner = 'https://solid.nodezero.social/owner/profile/card#me'
const circle = 'https://solid.nodezero.social/circle/profile/card#me'
const wider = 'https://solid.nodezero.social/wider/profile/card#me'

function post(id: string, authorWebId: string, createdAt: string) {
  return { id, authorWebId, createdAt }
}

const chronological = [
  post('a', wider, '2026-09-01T12:00:00.000Z'),
  post('b', circle, '2026-09-01T11:00:00.000Z'),
  post('c', owner, '2026-09-01T10:00:00.000Z'),
]

const base = {
  trustCircleWebIds: [circle],
  ownerWebId: owner,
}

void test('at zero weighting the order is strictly chronological', () => {
  const ranked = rankFeedPosts(chronological, { ...base, deepTies: 0, serendipity: 0 })
  assert.deepEqual(ranked.map((p) => p.id), ['a', 'b', 'c'])
})

void test('deep ties lifts a Trust Circle post above a newer non-circle post', () => {
  // `b` is 1h older than `a`; a full deep-ties boost is worth 12h.
  const ranked = rankFeedPosts(chronological, { ...base, deepTies: 100, serendipity: 0 })
  assert.deepEqual(ranked.map((p) => p.id), ['b', 'a', 'c'])
})

void test('a partial weighting smaller than the age gap does not reorder', () => {
  // 10% of 12h = 1.2h boost, but `b` also competes with serendipity on `a`.
  const ranked = rankFeedPosts(chronological, { ...base, deepTies: 5, serendipity: 0 })
  assert.deepEqual(ranked.map((p) => p.id), ['a', 'b', 'c'])
})

void test('serendipity lifts connections outside the Trust Circle', () => {
  const posts = [
    post('circle-new', circle, '2026-09-01T12:00:00.000Z'),
    post('wider-old', wider, '2026-09-01T08:00:00.000Z'),
  ]
  // 4h gap; a full serendipity boost is worth 6h.
  const ranked = rankFeedPosts(posts, { ...base, deepTies: 0, serendipity: 100 })
  assert.deepEqual(ranked.map((p) => p.id), ['wider-old', 'circle-new'])
})

void test('the viewer\u2019s own posts are never boosted', () => {
  assert.equal(boostMsForAuthor(owner, { ...base, deepTies: 100, serendipity: 100 }), 0)
})

void test('boosts are bounded by the documented maxima', () => {
  const hour = 3_600_000
  assert.equal(
    boostMsForAuthor(circle, { ...base, deepTies: 100, serendipity: 0 }),
    TRUST_CIRCLE_MAX_BOOST_HOURS * hour
  )
  assert.equal(
    boostMsForAuthor(wider, { ...base, deepTies: 0, serendipity: 100 }),
    WIDER_NETWORK_MAX_BOOST_HOURS * hour
  )
})

void test('out-of-range and non-finite slider values are clamped', () => {
  const hour = 3_600_000
  assert.equal(
    boostMsForAuthor(circle, { ...base, deepTies: 999, serendipity: 0 }),
    TRUST_CIRCLE_MAX_BOOST_HOURS * hour
  )
  assert.equal(boostMsForAuthor(circle, { ...base, deepTies: -50, serendipity: 0 }), 0)
  assert.equal(boostMsForAuthor(circle, { ...base, deepTies: Number.NaN, serendipity: 0 }), 0)
})

void test('ranking is deterministic and stable for equal effective times', () => {
  const sameTime = [
    post('z', wider, '2026-09-01T12:00:00.000Z'),
    post('a', wider, '2026-09-01T12:00:00.000Z'),
    post('m', wider, '2026-09-01T12:00:00.000Z'),
  ]
  const input = { ...base, deepTies: 40, serendipity: 40 }
  const first = rankFeedPosts(sameTime, input).map((p) => p.id)
  const second = rankFeedPosts([...sameTime].reverse(), input).map((p) => p.id)

  assert.deepEqual(first, ['a', 'm', 'z'])
  assert.deepEqual(first, second)
})

void test('posts with an unparseable timestamp sort last instead of being dropped', () => {
  const posts = [post('bad', wider, 'not-a-date'), post('good', wider, '2026-09-01T10:00:00.000Z')]
  const ranked = rankFeedPosts(posts, { ...base, deepTies: 0, serendipity: 0 })

  assert.deepEqual(ranked.map((p) => p.id), ['good', 'bad'])
  assert.equal(ranked.length, 2)
})
