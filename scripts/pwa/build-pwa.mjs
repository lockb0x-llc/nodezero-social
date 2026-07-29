#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { copyFile, readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..')
const appRoot = path.join(workspaceRoot, 'packages', 'mobile-app')
const distRoot = path.join(appRoot, 'dist')
const envProfile = process.env.NZ_ENV_PROFILE ?? 'local'
const appOrigin = process.env.NZ_APP_ORIGIN ??
  (envProfile === 'staging-testnet' ? 'https://staging.nodezero.social' : '')

if (envProfile !== 'local' && !appOrigin) throw new Error(`NZ_APP_ORIGIN is required for ${envProfile}.`)
if (appOrigin && new URL(appOrigin).origin !== appOrigin) {
  throw new Error('NZ_APP_ORIGIN must be an absolute origin without a path.')
}

const profileLabel = envProfile === 'staging-testnet' ? 'NodeZero Testnet' : 'NodeZero'
const cachePrefix = `nodezero-pwa-${envProfile}`
const pwaDir = path.join(distRoot, 'pwa')
await mkdir(pwaDir, { recursive: true })

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let current = value
  for (let bit = 0; bit < 8; bit += 1) current = (current & 1) ? 0xedb88320 ^ (current >>> 1) : current >>> 1
  return current >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function createIcon(size, maskable = false) {
  const stride = size * 4 + 1
  const pixels = Buffer.alloc(stride * size)
  const center = (size - 1) / 2
  const radius = size * (maskable ? 0.34 : 0.43)
  const stroke = Math.max(3, Math.round(size * 0.065))
  for (let y = 0; y < size; y += 1) {
    const row = y * stride
    pixels[row] = 0
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4
      const distance = Math.hypot(x - center, y - center)
      const background = maskable || distance <= radius
      let color = background ? [8, 17, 31, 255] : [0, 0, 0, 0]
      const localX = (x - (center - radius * 0.62)) / (radius * 1.24)
      const localY = (y - (center - radius * 0.52)) / (radius * 1.04)
      const lineWidth = stroke / (radius * 1.24)
      const left = Math.abs(localX - 0.16) < lineWidth
      const right = Math.abs(localX - 0.84) < lineWidth
      const diagonal = Math.abs(localX - (0.16 + localY * 0.68)) < lineWidth
      if (localY >= 0 && localY <= 1 && localX >= 0 && localX <= 1 && (left || right || diagonal)) {
        color = [83, 166, 255, 255]
      }
      pixels.set(color, offset)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(pixels, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

for (const [fileName, size, maskable] of [
  ['icon-180.png', 180, false],
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  await writeFile(path.join(pwaDir, fileName), createIcon(size, maskable))
}

const manifest = {
  id: appOrigin ? `${appOrigin}/` : '/',
  name: profileLabel,
  short_name: envProfile === 'staging-testnet' ? 'NodeZero Testnet' : 'NodeZero',
  description: 'A decentralized social application with user-owned identity and data.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#080f1c',
  theme_color: '#080f1c',
  categories: ['social'],
  icons: [
    { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
await writeFile(path.join(distRoot, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`)

async function collectFiles(directory, relativeRoot = '') {
  const entries = await readdir(directory)
  const files = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry)
    const relative = path.posix.join(relativeRoot, entry)
    if ((await stat(absolute)).isDirectory()) files.push(...await collectFiles(absolute, relative))
    else files.push(relative)
  }
  return files
}

const allFiles = await collectFiles(distRoot)
const precacheFiles = allFiles
  .filter((file) =>
    file === 'index.html' ||
    file === 'favicon.ico' ||
    file === 'manifest.webmanifest' ||
    file.startsWith('_expo/static/js/') ||
    file.startsWith('pwa/')
  )
  .map((file) => `/${file}`)
precacheFiles.push('/pwa-bootstrap.js')
precacheFiles.sort()
const bootstrap = `(() => {
  const APP_ORIGIN = ${JSON.stringify(appOrigin)};
  if (!APP_ORIGIN || window.location.origin !== APP_ORIGIN) return;
  window.__NZ_PWA_BOOTSTRAPPED__ = true;
  const addLink = (rel, href, attributes = {}) => {
    if (document.head.querySelector('link[rel="' + rel + '"][href="' + href + '"]')) return;
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
    document.head.appendChild(link);
  };
  addLink('manifest', '/manifest.webmanifest');
  addLink('apple-touch-icon', '/pwa/icon-180.png', { sizes: '180x180' });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => undefined), { once: true });
  }
})();
`
await writeFile(path.join(distRoot, 'pwa-bootstrap.js'), bootstrap)

const indexPath = path.join(distRoot, 'index.html')
let html = await readFile(indexPath, 'utf8')
const headElements = [
  ['/manifest.webmanifest', '  <link rel="manifest" href="/manifest.webmanifest" />'],
  ['/pwa/icon-180.png', '  <link rel="apple-touch-icon" href="/pwa/icon-180.png" sizes="180x180" />'],
  ['name="theme-color"', '  <meta name="theme-color" content="#080f1c" />'],
  ['name="apple-mobile-web-app-capable"', '  <meta name="apple-mobile-web-app-capable" content="yes" />'],
  ['name="apple-mobile-web-app-status-bar-style"', '  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />'],
  ['/pwa-bootstrap.js', '  <script src="/pwa-bootstrap.js" defer></script>'],
]
if (appOrigin) {
  headElements.splice(2, 0, [
    `rel="canonical" href="${appOrigin}/"`,
    `  <link rel="canonical" href="${appOrigin}/" />`,
  ])
}
for (const [marker, element] of headElements) {
  if (!html.includes(marker)) html = html.replace('</head>', `${element}\n</head>`)
}
await writeFile(indexPath, html)
await copyFile(
  path.join(appRoot, 'staticwebapp.config.json'),
  path.join(distRoot, 'staticwebapp.config.json'),
)

const revisionHash = createHash('sha256')
for (const url of precacheFiles) {
  const filePath = path.join(distRoot, url.slice(1))
  revisionHash.update(url)
  revisionHash.update(await readFile(filePath))
}
const revision = revisionHash.digest('hex').slice(0, 16)
const cacheName = `${cachePrefix}-${revision}`

const serviceWorker = `const CACHE_PREFIX = ${JSON.stringify(`${cachePrefix}-`)};
const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE_URLS = ${JSON.stringify(precacheFiles, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(
    names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name))
  )).then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'NZ_ACTIVATE_UPDATE') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }
  if (!PRECACHE_URLS.includes(url.pathname)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
`
await writeFile(path.join(distRoot, 'service-worker.js'), serviceWorker)

console.log(`[pwa] Built ${profileLabel} shell for ${appOrigin || 'local development'} with ${precacheFiles.length} precached assets.`)