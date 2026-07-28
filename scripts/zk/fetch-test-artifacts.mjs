#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifestPath = resolve(
  repoRoot,
  'deployments',
  'zk-testnet-lockbox-bridge-v3-artifacts.json',
)
const artifactBaseUrl = (
  process.env.NZ_ZK_TEST_ARTIFACTS_URL ??
  'https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/'
).replace(/\/+$/, '')

const requiredFiles = [
  'packages/zk-crypto/build/lockb0x_bridge_v3/pod_stellar_bridge_v3_js/pod_stellar_bridge_v3.wasm',
  'packages/zk-crypto/build/lockb0x_bridge_v3/pod_stellar_bridge_v3_final.zkey',
  'packages/zk-crypto/build/lockb0x_bridge_v3/pod_stellar_bridge_v3_vk.json',
]

async function sha256(filePath) {
  const bytes = await readFile(filePath)
  return createHash('sha256').update(bytes).digest('hex')
}

function publishedPath(file) {
  const prefix = 'packages/zk-crypto/build/lockb0x_bridge_v3/'
  if (!file.startsWith(prefix)) throw new Error(`Artifact path is outside the ZK build root: ${file}`)
  return `lockb0x_bridge_v3/${file.slice(prefix.length)}`
}

async function ensureArtifact(entry) {
  const target = resolve(repoRoot, ...entry.file.split('/'))
  if (!target.startsWith(`${resolve(repoRoot, 'packages', 'zk-crypto', 'build')}${sep}`)) {
    throw new Error(`Refusing to write outside the ZK build directory: ${entry.file}`)
  }

  try {
    const existing = await stat(target)
    if (existing.size === entry.bytes && (await sha256(target)) === entry.sha256) {
      console.log(`[zk-test-artifacts] verified ${entry.file}`)
      return
    }
  } catch {
    // Missing or invalid artifacts are replaced from the integrity-pinned source.
  }

  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.download`
  await rm(temporary, { force: true })
  const url = `${artifactBaseUrl}/${publishedPath(entry.file)}`
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Artifact download failed (${response.status}) for ${url}`)
  }
  await finished(Readable.fromWeb(response.body).pipe(createWriteStream(temporary)))

  const downloaded = await stat(temporary)
  const digest = await sha256(temporary)
  if (downloaded.size !== entry.bytes || digest !== entry.sha256) {
    await rm(temporary, { force: true })
    throw new Error(`Artifact integrity check failed for ${entry.file}`)
  }
  await rename(temporary, target)
  console.log(`[zk-test-artifacts] downloaded and verified ${entry.file}`)
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    manifest.network !== 'testnet' ||
    manifest.circuitVersion !== 3 ||
    !Array.isArray(manifest.artifacts)
  ) {
    throw new Error('ZK Testnet artifact manifest is malformed or targets the wrong network.')
  }

  const entries = new Map(manifest.artifacts.map((entry) => [entry.file, entry]))
  for (const file of requiredFiles) {
    const entry = entries.get(file)
    if (
      !entry ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      typeof entry.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.sha256)
    ) {
      throw new Error(`Required ZK test artifact is missing or invalid in the manifest: ${file}`)
    }
    await ensureArtifact(entry)
  }
}

main().catch((error) => {
  console.error(`[zk-test-artifacts] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
