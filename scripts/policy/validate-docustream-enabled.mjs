import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const files = {
  screen: resolve(root, 'packages/mobile-app/app/docustream.tsx'),
  activities: resolve(root, 'packages/solid-pod-sync/src/DocustreamManager.ts'),
  sources: resolve(root, 'packages/solid-pod-sync/src/DocustreamSourceManager.ts'),
}

const [screen, activities, sources] = await Promise.all(
  Object.values(files).map((path) => readFile(path, 'utf8')),
)

const failures = []
if (!screen.includes('const DOCUSTREAM_LOCKED = false')) {
  failures.push('DocuStream UI must remain unlocked.')
}
if (screen.includes('const DOCUSTREAM_LOCKED = true')) {
  failures.push('DocuStream UI lock was re-enabled.')
}
if (activities.includes('temporarily disabled during the storage refactor lock')) {
  failures.push('DocuStream activity persistence was relocked.')
}
if (sources.includes('temporarily disabled during the storage refactor lock')) {
  failures.push('DocuStream source persistence was relocked.')
}
for (const required of ['If-Match', 'If-None-Match', 'syncProfileLinks']) {
  if (!sources.includes(required)) failures.push(`DocuStream source safety marker is missing: ${required}.`)
}
if (!activities.includes('read-back did not match')) {
  failures.push('DocuStream activity read-back verification is missing.')
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[policy:docustream] FAIL: ${failure}`)
  process.exitCode = 1
} else {
  console.log('[policy:docustream] PASS')
}