#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const isWindows = process.platform === 'win32'
const pnpmCli = isWindows
  ? join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  : null
if (isWindows && !existsSync(pnpmCli)) throw new Error(`Unable to resolve pnpm CLI at ${pnpmCli}.`)
const pnpm = isWindows ? process.execPath : 'pnpm'
const pnpmPrefix = isWindows ? [pnpmCli] : []
const target = mkdtempSync(join(tmpdir(), 'nodezero-provisioner-runtime-'))

function run(label, args, options = {}) {
  console.log(`[qa:provisioner-runtime] RUN ${label}`)
  const result = spawnSync(pnpm, [...pnpmPrefix, ...args], {
    cwd: options.cwd ?? root,
    encoding: options.encoding,
    stdio: options.encoding ? 'pipe' : 'inherit',
    shell: false,
  })
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    throw result.error ?? new Error(`${label} exited with ${result.status ?? 'unknown status'}.`)
  }
  console.log(`[qa:provisioner-runtime] PASS ${label}`)
  return result.stdout
}

try {
  rmSync(join(root, 'packages', 'jss-provisioner', 'dist'), { recursive: true, force: true })
  rmSync(join(root, 'packages', 'solid-pod-sync', 'dist'), { recursive: true, force: true })
  run('clean package build', ['--filter', '@nodezero/jss-provisioner', 'build'])
  run('frozen runtime deployment', [
    '--config.inject-workspace-packages=true',
    '--filter',
    '@nodezero/jss-provisioner',
    'deploy',
    '--prod',
    target,
  ])

  const runtimeChecks = [
    ['snarkjs', '0.7.5'],
    ['@stellar/stellar-sdk', '16.0.1'],
    ['bfj', '9.1.3'],
    ['axios', '1.19.0'],
    ['brace-expansion', '2.1.4'],
  ]
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        `const fs=require('fs'),path=require('path');const root=process.argv[1];const direct=['snarkjs','@stellar/stellar-sdk','@nodezero/solid-pod-sync'];const entries=Object.fromEntries(direct.map(name=>[name,require.resolve(name,{paths:[root]})]));const bases=[root,...Object.values(entries).map(path.dirname)];function version(name){let entry;for(const base of bases){try{entry=require.resolve(name,{paths:[base]});break}catch{}}if(!entry)throw new Error('Unable to resolve '+name);let dir=path.dirname(entry);for(;;){const manifest=path.join(dir,'package.json');if(fs.existsSync(manifest)){const json=require(manifest);if(json.name===name)return json.version}const parent=path.dirname(dir);if(parent===dir)break;dir=parent}throw new Error('Unable to locate manifest for '+name)}const out={};for(const [name] of ${JSON.stringify(runtimeChecks)})out[name]=version(name);out.solidExports=Object.keys(require(entries['@nodezero/solid-pod-sync'])).length;console.log(JSON.stringify(out))`,
        target,
      ],
      { cwd: root, encoding: 'utf8' }
    )
  )
  for (const [name, expected] of runtimeChecks) {
    if (result[name] !== expected) {
      throw new Error(`Expected ${name}@${expected}; resolved ${String(result[name])}.`)
    }
  }
  if (!Number.isInteger(result.solidExports) || result.solidExports <= 0) {
    throw new Error('Vendored Solid package did not expose its runtime API.')
  }

  const auditJson = run('production vulnerability audit', ['audit', '--prod', '--json'], {
    cwd: target,
    encoding: 'utf8',
  })
  const audit = JSON.parse(auditJson)
  const vulnerabilities = audit.metadata?.vulnerabilities
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    if (vulnerabilities?.[severity] !== 0) {
      throw new Error(
        `Provisioner runtime contains ${vulnerabilities?.[severity]} ${severity} vulnerabilities.`
      )
    }
  }
  if (!readFileSync(join(target, 'dist', 'index.js'), 'utf8').includes('use strict')) {
    throw new Error('Provisioner runtime is missing the compiled entrypoint.')
  }
  const startup = readFileSync(join(target, 'startup.sh'), 'utf8')
  const installer = readFileSync(join(target, 'install-stellar-cli.sh'), 'utf8')
  const archiveDigest = startup.match(/STELLAR_ARCHIVE_SHA256="([0-9a-f]{64})"/)?.[1]
  const binaryDigest = startup.match(/STELLAR_BINARY_SHA256="([0-9a-f]{64})"/)?.[1]
  if (archiveDigest !== '357bf712f6353c28cd33c794402a3c87231757a5b305e6ef1604365af4fdd556') {
    throw new Error('Provisioner runtime is missing the approved Stellar CLI archive digest.')
  }
  if (binaryDigest !== '14a71be83c2f31686b2b32a2d302fd226e6872c1b46a9c23daaa693a9bf98d80') {
    throw new Error('Provisioner runtime is missing the approved Stellar CLI executable digest.')
  }
  if (
    !/sha256sum --check --status/.test(installer) ||
    !/verify_sha256 "\$binary_sha256" "\$binary"/.test(installer) ||
    !/stellar\(\) \{[\s\S]*"\$STELLAR_BIN" "\$@"/.test(startup) ||
    /command -v stellar/.test(startup) ||
    /JSS_STELLAR_CLI_(URL|SHA256)/.test(startup)
  ) {
    throw new Error('Provisioner startup does not fail closed on Stellar CLI archive tampering.')
  }
  const fixtureRoot = join(target, 'stellar-integrity-fixture')
  const sourceRoot = join(fixtureRoot, 'source')
  const toolsRoot = join(fixtureRoot, 'tools')
  const pathRoot = join(fixtureRoot, 'malicious-path')
  mkdirSync(sourceRoot, { recursive: true })
  mkdirSync(toolsRoot, { recursive: true })
  mkdirSync(pathRoot, { recursive: true })
  const binary = Buffer.from('#!/usr/bin/env bash\necho verified-stellar\n')
  writeFileSync(join(sourceRoot, 'stellar'), binary)
  chmodSync(join(sourceRoot, 'stellar'), 0o755)
  const archivePath = join(fixtureRoot, 'stellar.tar.gz')
  const archive = spawnSync('tar', ['-czf', archivePath, '-C', sourceRoot, 'stellar'], {
    cwd: target,
    shell: false,
  })
  if (archive.status !== 0) throw new Error('Unable to create Stellar integrity fixture archive.')
  const archiveDigestFixture = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
  const binaryDigestFixture = createHash('sha256').update(binary).digest('hex')
  writeFileSync(join(toolsRoot, 'stellar-cli.tar.gz'), readFileSync(archivePath))
  writeFileSync(join(pathRoot, 'stellar'), Buffer.from('#!/usr/bin/env bash\necho malicious\n'))
  chmodSync(join(pathRoot, 'stellar'), 0o755)

  const installerCommand = `PATH="$(pwd)/stellar-integrity-fixture/malicious-path:$PATH"; . './install-stellar-cli.sh'; install_stellar_cli 'stellar-integrity-fixture/tools' 'https://invalid.example/stellar.tar.gz' '${archiveDigestFixture}' '${binaryDigestFixture}'`
  const firstInstall = spawnSync('bash', ['-lc', installerCommand], {
    cwd: target,
    encoding: 'utf8',
    shell: false,
  })
  if (
    firstInstall.status !== 0 ||
    createHash('sha256')
      .update(readFileSync(join(toolsRoot, 'stellar')))
      .digest('hex') !== binaryDigestFixture
  ) {
    throw new Error(
      `Stellar CLI installer did not produce the verified pinned binary: ${firstInstall.stderr}`
    )
  }
  writeFileSync(join(toolsRoot, 'stellar'), Buffer.from('tampered'))
  const repairedInstall = spawnSync('bash', ['-lc', installerCommand], {
    cwd: target,
    shell: false,
  })
  if (
    repairedInstall.status !== 0 ||
    createHash('sha256')
      .update(readFileSync(join(toolsRoot, 'stellar')))
      .digest('hex') !== binaryDigestFixture
  ) {
    throw new Error('Stellar CLI installer did not repair a tampered cached binary.')
  }
  writeFileSync(join(toolsRoot, 'stellar'), Buffer.from('tampered'))
  writeFileSync(join(toolsRoot, 'stellar-cli.tar.gz'), Buffer.from('tampered'))
  const rejected = spawnSync(
    'bash',
    [
      '-lc',
      `. './install-stellar-cli.sh'; install_stellar_cli 'stellar-integrity-fixture/tools' 'https://invalid.example/missing' '${archiveDigestFixture}' '${binaryDigestFixture}'`,
    ],
    { cwd: target, shell: false }
  )
  if (rejected.status === 0)
    throw new Error('Stellar CLI installer accepted tampered cached artifacts.')
  console.log('[qa:provisioner-runtime] PASS reproducible runtime closure')
} finally {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch (error) {
    console.warn(
      `[qa:provisioner-runtime] WARN temporary runtime cleanup failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
