import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as rssParser from 'react-native-rss-parser'

void test('RSS parsing remains compatible with the maintained xmldom alias', async () => {
  const feed = await rssParser.parse(`<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><title>NodeZero</title><link>https://nodezero.social/</link>
    <description>Security updates</description><item><title>Release</title>
    <link>https://nodezero.social/releases/q</link><description>Milestone Q</description></item>
    </channel></rss>`)
  assert.equal(feed.title, 'NodeZero')
  const items = feed.items ?? []
  assert.equal(items.length, 1)
  assert.equal(items[0]?.title, 'Release')
})
