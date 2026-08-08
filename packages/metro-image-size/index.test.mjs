import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import imageSize from './index.cjs'

const faviconPath = fileURLToPath(new URL('../mobile-app/assets/favicon.png', import.meta.url))

void test('reads the Expo favicon dimensions from a buffer', async () => {
  const dimensions = imageSize(await readFile(faviconPath))
  assert.ok(dimensions.width > 0)
  assert.ok(dimensions.height > 0)
})

void test('reads the Expo favicon dimensions from a file path', () => {
  const dimensions = imageSize(faviconPath)
  assert.ok(dimensions.width > 0)
  assert.ok(dimensions.height > 0)
})

void test('rejects malformed image data', () => {
  assert.throws(() => imageSize(Buffer.from('not an image')), /Unsupported or malformed image/)
})
