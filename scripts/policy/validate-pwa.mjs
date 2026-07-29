#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

const requiredChecks = [
  ['packages/mobile-app/app.config.js', ['NZ_APP_ORIGIN', "output: 'single'", 'pwaCachePrefix']],
  ['packages/mobile-app/src/pwa/registerPwa.ts', ['window.location.origin !== appOrigin', '/service-worker.js', '/manifest.webmanifest']],
  ['scripts/pwa/build-pwa.mjs', ['manifest.webmanifest', 'service-worker.js', "request.mode === 'navigate'", "url.origin !== self.location.origin"]],
  ['packages/mobile-app/staticwebapp.config.json', ['/_expo/static/*', 'max-age=31536000, immutable', '/service-worker.js', 'Service-Worker-Allowed']],
  ['.github/workflows/staging-deploy.yml', ['concurrency:', 'cancel-in-progress: false', 'NZ_APP_ORIGIN: https://staging.nodezero.social']],
]

for (const [filePath, markers] of requiredChecks) {
  const contents = await readFile(filePath, 'utf8')
  for (const marker of markers) {
    if (!contents.includes(marker)) throw new Error(`${filePath} is missing PWA invariant: ${marker}`)
  }
}

const workerSource = await readFile('scripts/pwa/build-pwa.mjs', 'utf8')
for (const forbidden of ['/v1/', 'pod-proxy', 'solid.nodezero.social', 'api.nodezero.social']) {
  if (workerSource.includes(`PRECACHE_URLS.includes(${JSON.stringify(forbidden)}`)) {
    throw new Error(`PWA worker must not precache sensitive route marker: ${forbidden}`)
  }
}

console.log('[policy:pwa] PASS')