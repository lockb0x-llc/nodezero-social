#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { hashRelayPayload } from './hash-relay-payload.mjs'

const root = resolve(import.meta.dirname, '../..')
const isWindows = process.platform === 'win32'
const pnpmCli = isWindows
  ? join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  : null
if (isWindows && !existsSync(pnpmCli)) throw new Error(`Unable to resolve pnpm CLI at ${pnpmCli}.`)
const pnpm = isWindows ? process.execPath : 'pnpm'
const pnpmPrefix = isWindows ? [pnpmCli] : []
const npmCli = isWindows
  ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  : null
if (isWindows && !existsSync(npmCli)) throw new Error(`Unable to resolve npm CLI at ${npmCli}.`)
const npm = isWindows ? process.execPath : 'npm'
const npmPrefix = isWindows ? [npmCli] : []
const target = mkdtempSync(join(tmpdir(), 'nodezero-relay-runtime-'))
const archive = `${target}.zip`
const extracted = `${target}-extracted`

function run(label, command, args, cwd = root) {
  console.log(`[qa:relay-runtime] RUN ${label}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false })
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${label} exited with ${result.status ?? 'unknown status'}.`)
  }
  console.log(`[qa:relay-runtime] PASS ${label}`)
}

function assertNoLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Relay artifact contains link: ${path}`)
    if (stat.isDirectory()) assertNoLinks(path)
  }
}

function runArchiveCommand(label, command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false })
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${label} exited with ${result.status ?? 'unknown status'}.`)
  }
}

function createAndExtractArchive() {
  mkdirSync(join(extracted, 'deploy'), { recursive: true })
  if (isWindows) {
    runArchiveCommand('create relay archive', 'tar.exe', ['-a', '-cf', archive, '-C', target, '.'])
    runArchiveCommand('extract relay archive', 'tar.exe', [
      '-xf',
      archive,
      '-C',
      join(extracted, 'deploy'),
    ])
  } else {
    runArchiveCommand('create relay archive', 'zip', ['-qr', archive, '.'], target)
    runArchiveCommand('extract relay archive', 'unzip', [
      '-q',
      archive,
      '-d',
      join(extracted, 'deploy'),
    ])
  }
  return join(extracted, 'deploy')
}

function assertDependencyContract() {
  const sourceManifest = JSON.parse(
    readFileSync(join(root, 'packages', 'relay-service', 'package.json'), 'utf8')
  )
  const runtimeManifest = JSON.parse(
    readFileSync(join(root, 'packages', 'relay-service', 'runtime', 'package.json'), 'utf8')
  )
  for (const name of ['@stellar/stellar-sdk', 'ws']) {
    const sourceRange = sourceManifest.dependencies?.[name]
    const runtimeVersion = runtimeManifest.dependencies?.[name]
    const sourceMinimum = String(sourceRange ?? '')
      .match(/(\d+)\.(\d+)\.(\d+)/)
      ?.slice(1)
      .map(Number)
    const runtimeParts = String(runtimeVersion ?? '')
      .match(/^(\d+)\.(\d+)\.(\d+)$/)
      ?.slice(1)
      .map(Number)
    if (!sourceMinimum || !runtimeParts || sourceMinimum[0] !== runtimeParts[0]) {
      throw new Error(`Relay source/runtime dependency contract diverged for ${name}.`)
    }
    const sourceValue = sourceMinimum[0] * 1_000_000 + sourceMinimum[1] * 1_000 + sourceMinimum[2]
    const runtimeValue = runtimeParts[0] * 1_000_000 + runtimeParts[1] * 1_000 + runtimeParts[2]
    if (runtimeValue < sourceValue) {
      throw new Error(
        `Relay runtime ${name}@${runtimeVersion} is below source range ${sourceRange}.`
      )
    }
  }
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to reserve relay test port.')
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()))
  })
  return address.port
}

async function assertPackagedServerStarts(artifactRoot) {
  const port = await reservePort()
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: artifactRoot,
    env: { ...process.env, RELAY_PORT: String(port), RELAY_PROVISIONER_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    output += String(chunk)
  })
  try {
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error(`Packaged relay exited with ${child.exitCode}: ${output}`)
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`)
        const health = await response.json()
        if (response.status === 200 && health.ok === true && health.service === 'relay-service') {
          console.log('[qa:relay-runtime] PASS packaged relay liveness')
          return
        }
      } catch {
        // The process may not have bound the port yet.
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    }
    throw new Error(`Packaged relay did not become live: ${output}`)
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolvePromise) => {
      if (child.exitCode !== null) resolvePromise()
      else child.once('exit', resolvePromise)
    })
  }
}

try {
  assertDependencyContract()
  rmSync(join(root, 'packages', 'relay-service', 'dist'), { recursive: true, force: true })
  run('clean package build', pnpm, [...pnpmPrefix, '--filter', '@nodezero/relay-service', 'build'])
  mkdirSync(join(target, 'dist'), { recursive: true })
  cpSync(join(root, 'packages', 'relay-service', 'dist'), join(target, 'dist'), {
    recursive: true,
  })
  for (const name of ['package.json', 'package-lock.json']) {
    cpSync(join(root, 'packages', 'relay-service', 'runtime', name), join(target, 'dist', name))
  }
  run('npm ci runtime deployment', npm, [
    ...npmPrefix,
    'ci',
    '--prefix',
    join(target, 'dist'),
    '--omit=dev',
    '--ignore-scripts',
    '--bin-links=false',
  ])
  const expectedPayload = hashRelayPayload(target)
  writeFileSync(
    join(target, 'build-info.json'),
    `${JSON.stringify({ commit: 'runtime-validation', payloadSha256: expectedPayload })}\n`
  )
  assertNoLinks(target)
  if (existsSync(join(target, 'package.json')) || existsSync(join(target, 'node_modules'))) {
    throw new Error(
      'Relay artifact exposes a root Node project that can trigger Kudu optimization.'
    )
  }
  const runtime = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        `const fs=require('fs'),path=require('path');const root=process.argv[1];function version(name,bases=[root]){const entry=require.resolve(name,{paths:bases});require(entry);let dir=path.dirname(entry);for(;;){const manifest=path.join(dir,'package.json');if(fs.existsSync(manifest)){const json=require(manifest);if(json.name===name)return {version:json.version,entry}}const parent=path.dirname(dir);if(parent===dir)break;dir=parent}throw new Error('Unable to locate manifest for '+name)};const stellar=version('@stellar/stellar-sdk');const smol=version('smol-toml',[path.dirname(stellar.entry),root]);const ws=version('ws');require(path.join(root,'relayChallenge.js'));console.log(JSON.stringify({stellar:stellar.version,smol:smol.version,ws:ws.version}))`,
        join(target, 'dist'),
      ],
      { encoding: 'utf8' }
    )
  )
  if (runtime.stellar !== '16.0.1' || runtime.smol !== '1.7.0' || runtime.ws !== '8.21.0') {
    throw new Error(`Unexpected relay runtime versions: ${JSON.stringify(runtime)}`)
  }
  const audit = JSON.parse(
    execFileSync(npm, [...npmPrefix, 'audit', '--omit=dev', '--json'], {
      cwd: join(target, 'dist'),
      encoding: 'utf8',
    })
  )
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    if (audit.metadata?.vulnerabilities?.[severity] !== 0) {
      throw new Error(
        `Relay runtime contains ${audit.metadata?.vulnerabilities?.[severity]} ${severity} vulnerabilities.`
      )
    }
  }
  const source = readFileSync(join(root, 'packages', 'relay-service', 'src', 'index.ts'), 'utf8')
  if (
    !source.includes("requestUrl.pathname === '/healthz'") ||
    !source.includes("requestUrl.pathname === '/health'")
  ) {
    throw new Error('Relay must expose separate liveness and dependency-readiness endpoints.')
  }
  const extractedRoot = createAndExtractArchive()
  assertNoLinks(extractedRoot)
  if (
    existsSync(join(extractedRoot, 'package.json')) ||
    existsSync(join(extractedRoot, 'node_modules'))
  ) {
    throw new Error('Extracted relay archive exposes a root Node project.')
  }
  const buildInfo = JSON.parse(readFileSync(join(extractedRoot, 'build-info.json'), 'utf8'))
  const extractedPayload = hashRelayPayload(extractedRoot)
  if (buildInfo.payloadSha256 !== expectedPayload || extractedPayload !== expectedPayload) {
    throw new Error('Extracted relay archive does not preserve canonical payload provenance.')
  }
  await assertPackagedServerStarts(extractedRoot)
  console.log('[qa:relay-runtime] PASS reproducible optimizer-inert runtime closure')
} finally {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    rmSync(extracted, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    rmSync(archive, { force: true })
  } catch (error) {
    console.warn(
      `[qa:relay-runtime] WARN temporary runtime cleanup failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
