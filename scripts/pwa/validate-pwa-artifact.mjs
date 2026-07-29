#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..')
const distRoot = path.join(workspaceRoot, 'packages', 'mobile-app', 'dist')
const expectedOrigin = process.env.NZ_APP_ORIGIN ?? ''
const expectedProfile = process.env.NZ_ENV_PROFILE ?? 'local'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const html = await readFile(path.join(distRoot, 'index.html'), 'utf8')
const manifest = JSON.parse(await readFile(path.join(distRoot, 'manifest.webmanifest'), 'utf8'))
const worker = await readFile(path.join(distRoot, 'service-worker.js'), 'utf8')
const bootstrap = await readFile(path.join(distRoot, 'pwa-bootstrap.js'), 'utf8')
const swaConfig = JSON.parse(await readFile(path.join(distRoot, 'staticwebapp.config.json'), 'utf8'))

assert(html.includes('rel="manifest" href="/manifest.webmanifest"'), 'index.html is missing the manifest link.')
assert(html.includes('rel="apple-touch-icon"'), 'index.html is missing the Apple touch icon.')
assert(html.includes('/pwa-bootstrap.js'), 'index.html is missing the PWA bootstrap script.')
if (expectedOrigin) {
  assert(manifest.id === `${expectedOrigin}/`, `Manifest id does not match ${expectedOrigin}.`)
  assert(html.includes(`rel="canonical" href="${expectedOrigin}/"`), 'Canonical link does not match the app origin.')
  assert(bootstrap.includes(`const APP_ORIGIN = ${JSON.stringify(expectedOrigin)}`), 'PWA bootstrap origin does not match the app origin.')
}
assert(manifest.start_url === '/' && manifest.scope === '/', 'Manifest start_url and scope must be root.')
assert(manifest.display === 'standalone', 'Manifest display must be standalone.')
assert(Array.isArray(manifest.icons) && manifest.icons.some((icon) => icon.purpose === 'maskable'), 'Manifest requires a maskable icon.')
assert(worker.includes(`nodezero-pwa-${expectedProfile}-`), 'Service-worker cache prefix does not match the environment profile.')
assert(worker.includes("request.mode === 'navigate'"), 'Service worker is missing the offline navigation fallback.')
assert(worker.includes('"/pwa-bootstrap.js"'), 'Service worker must precache the bootstrap required by the offline shell.')
assert(worker.includes('"/manifest.webmanifest"'), 'Service worker must precache the install manifest.')
for (const forbidden of ['/v1/', 'pod-proxy', 'api.nodezero.social', 'solid.nodezero.social']) {
  assert(!worker.includes(forbidden), `Service worker contains forbidden sensitive route marker: ${forbidden}`)
}
assert(Array.isArray(swaConfig.routes), 'Static Web Apps config is missing route-specific cache rules.')

for (const icon of [
  ['icon-180.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
]) {
  const [name, expectedSize] = icon
  const bytes = await readFile(path.join(distRoot, 'pwa', name))
  assert(bytes.subarray(1, 4).toString('ascii') === 'PNG', `${name} is not a PNG.`)
  assert(bytes.readUInt32BE(16) === expectedSize && bytes.readUInt32BE(20) === expectedSize, `${name} has invalid dimensions.`)
}

assert((await stat(path.join(distRoot, 'service-worker.js'))).size > 0, 'Service worker is empty.')
console.log(`[pwa:artifact] PASS (${manifest.name}, ${expectedOrigin || 'local'})`)