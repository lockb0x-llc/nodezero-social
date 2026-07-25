import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { collectNsfwAuthors, filterVisiblePosts } from './postVisibility'

void test('collectNsfwAuthors marks authors with NSFW external URLs', () => {
  const nsfwAuthors = collectNsfwAuthors([
    {
      authorWebId: 'https://solid.nodezero.social/alice/profile/card#me',
      externalUrl: 'https://example.com',
    },
    {
      authorWebId: 'https://solid.nodezero.social/bob/profile/card#me',
      externalUrl: 'https://onlyfans.com/bob',
    },
  ])

  assert.equal(nsfwAuthors.has('https://solid.nodezero.social/alice/profile/card#me'), false)
  assert.equal(nsfwAuthors.has('https://solid.nodezero.social/bob/profile/card#me'), true)
})

void test('filterVisiblePosts removes NSFW authors when showNsfw is false', () => {
  const posts = [
    { id: '1', authorWebId: 'a' },
    { id: '2', authorWebId: 'b' },
  ]
  const visible = filterVisiblePosts(posts, false, new Set(['b']))
  assert.deepEqual(visible, [{ id: '1', authorWebId: 'a' }])
})

void test('filterVisiblePosts keeps all posts when showNsfw is true', () => {
  const posts = [
    { id: '1', authorWebId: 'a' },
    { id: '2', authorWebId: 'b' },
  ]
  const visible = filterVisiblePosts(posts, true, new Set(['b']))
  assert.deepEqual(visible, posts)
})
