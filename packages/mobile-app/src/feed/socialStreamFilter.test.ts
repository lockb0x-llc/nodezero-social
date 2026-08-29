import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { filterSocialStreamItems } from './socialStreamFilter.js'

void test('filterSocialStreamItems keeps only broadcast/social items', () => {
  const items = [
    { id: '1', source: 'nodezero' },
    { id: '2', source: 'rss' },
    { id: '3', source: 'reddit' },
    { id: '4', source: 'x' },
    { id: '5', source: 'nodezero' },
  ]
  assert.deepEqual(
    filterSocialStreamItems(items).map((item) => item.id),
    ['1', '5']
  )
})

void test('filterSocialStreamItems returns an empty array when nothing qualifies', () => {
  assert.deepEqual(filterSocialStreamItems([{ id: '1', source: 'rss' }]), [])
})
