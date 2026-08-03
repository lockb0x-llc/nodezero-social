#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const phase = readPhase(process.argv)
const isWindows = process.platform === 'win32'
const pnpmCli = isWindows
  ? join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  : null
if (isWindows && !existsSync(pnpmCli)) fail(`Unable to resolve pnpm CLI at ${pnpmCli}.`)
const pnpm = isWindows ? process.execPath : 'pnpm'
const pnpmPrefix = isWindows ? [pnpmCli] : []
const git = isWindows ? 'git.exe' : 'git'

function fail(message) {
  console.error(`[q4-preflight] FAIL: ${message}`)
  process.exit(1)
}

function log(message) {
  console.log(`[q4-preflight] ${message}`)
}

function readPhase(argv) {
  const value = argv.find((arg) => arg.startsWith('--phase='))?.split('=')[1] ?? 'prepare'
  if (!['prepare', 'candidate', 'published', 'deployed'].includes(value)) {
    fail(`Unknown phase '${value}'. Expected prepare, candidate, published, or deployed.`)
  }
  return value
}

function output(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}

function run(label, command, args) {
  log(`RUN ${label}`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) {
    fail(`${label} could not start: ${result.error.message}`)
  }
  if (result.status !== 0) fail(`${label} exited with ${result.status ?? 'unknown status'}.`)
  log(`PASS ${label}`)
}

function assertRepositoryState() {
  const branch = output(git, ['branch', '--show-current'])
  if (branch !== 'testnet')
    fail(`Release candidate must be prepared from testnet, not '${branch}'.`)

  const head = output(git, ['rev-parse', 'HEAD'])
  if (!/^[0-9a-f]{40}$/.test(head)) fail('Unable to resolve a full candidate SHA.')
  log(`candidate SHA ${head}`)

  if (phase === 'prepare') {
    const dirty = output(git, ['status', '--porcelain'])
    log(
      dirty
        ? 'prepare phase: worktree changes are present and must be committed before candidate phase.'
        : 'prepare phase: worktree is clean.'
    )
    return head
  }

  const dirty = output(git, ['status', '--porcelain'])
  if (dirty) fail('Candidate/deployed phase requires a clean worktree.')
  const remoteLine = output(git, ['ls-remote', '--heads', 'origin', 'refs/heads/testnet'])
  const remoteHead = remoteLine.split(/\s+/)[0] ?? ''
  if (!/^[0-9a-f]{40}$/.test(remoteHead))
    fail('Unable to resolve authoritative origin/testnet SHA.')
  if (phase === 'candidate') {
    const ancestor = spawnSync(git, ['merge-base', '--is-ancestor', remoteHead, head])
    if (ancestor.status !== 0) {
      fail(`Candidate ${head} does not descend from authoritative origin/testnet ${remoteHead}.`)
    }
    log(`candidate is ready to publish over origin/testnet ${remoteHead}`)
    return head
  }
  if (remoteHead !== head) {
    fail(`${phase} phase requires origin/testnet ${remoteHead} to equal candidate ${head}.`)
  }
  return head
}

async function assertDeployed(head) {
  const response = await fetch('https://staging.nodezero.social/deploy-marker.json', {
    headers: { 'cache-control': 'no-cache' },
  })
  if (!response.ok) fail(`Deploy marker returned HTTP ${response.status}.`)
  const marker = await response.json()
  if (marker.environment !== 'staging-testnet' || marker.workflow !== 'staging-deploy') {
    fail('Live deploy marker is not a canonical staging-deploy marker.')
  }
  if (marker.commit !== head)
    fail(`Live marker commit ${String(marker.commit)} does not match ${head}.`)
  const runId = String(marker.runId ?? '')
  const runAttempt = String(marker.runAttempt ?? '')
  if (!/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt)) {
    fail('Live marker is missing a numeric runId/runAttempt.')
  }
  let run
  try {
    run = JSON.parse(
      output('gh', [
        'api',
        `repos/lockb0x-llc/nodezero-social/actions/runs/${runId}/attempts/${runAttempt}`,
      ])
    )
  } catch (error) {
    fail(
      `Unable to query GitHub deployment provenance: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.head_sha !== head ||
    String(run.run_attempt) !== runAttempt ||
    run.head_branch !== 'testnet' ||
    !String(run.path ?? '').endsWith('/staging-deploy.yml')
  ) {
    fail(`Marker run ${runId} attempt ${runAttempt} is not a successful exact-SHA staging deploy.`)
  }
  log(`PASS deployed provenance run ${runId} attempt ${runAttempt}: ${String(run.html_url)}`)
}

const head = assertRepositoryState()

const gates = [
  ['Solid tests', ['--filter', '@nodezero/solid-pod-sync', 'test']],
  ['provisioner tests', ['--filter', '@nodezero/jss-provisioner', 'test']],
  ['Solid type-check', ['--filter', '@nodezero/solid-pod-sync', 'type-check']],
  ['mobile tests', ['--filter', '@nodezero/mobile-app', 'test']],
  ['Waku tests', ['--filter', '@nodezero/waku-comms', 'test']],
  ['relay tests', ['--filter', '@nodezero/relay-service', 'test']],
  ['provisioner type-check', ['--filter', '@nodezero/jss-provisioner', 'type-check']],
  ['mobile type-check', ['--filter', '@nodezero/mobile-app', 'type-check']],
  ['Waku type-check', ['--filter', '@nodezero/waku-comms', 'type-check']],
  ['P2P type-check', ['--filter', '@nodezero/p2p-comms', 'type-check']],
  ['relay type-check', ['--filter', '@nodezero/relay-service', 'type-check']],
  ['Solid lint', ['--filter', '@nodezero/solid-pod-sync', 'lint']],
  ['Waku lint', ['--filter', '@nodezero/waku-comms', 'lint']],
  ['P2P lint', ['--filter', '@nodezero/p2p-comms', 'lint']],
  ['relay lint', ['--filter', '@nodezero/relay-service', 'lint']],
  ['device evidence tests', ['test:device-evidence']],
  ['consentful discovery smoke', ['qa:smoke:consentful-discovery']],
  ['consent security policy', ['policy:validate-consentful-discovery']],
  ['environment isolation policy', ['policy:validate-env']],
  ['attestation fail-closed policy', ['policy:validate-attestation-fail-closed']],
  ['DocuStream enabled policy', ['policy:validate-docustream-enabled']],
  ['PWA policy', ['policy:validate-pwa']],
  ['provisioner runtime closure', ['qa:validate:provisioner-runtime']],
  ['workspace production audit', ['qa:validate:production-audit']],
  [
    'workflow formatting',
    [
      'exec',
      'prettier',
      '--check',
      '.github/workflows/staging-deploy.yml',
      '.github/workflows/staging-rollback.yml',
      '.github/workflows/staging-baseline-capture.yml',
      'packages/jss-provisioner/runtime/package.json',
      'scripts/qa/validate-provisioner-runtime.mjs',
    ],
  ],
]

for (const [label, args] of gates) run(label, pnpm, [...pnpmPrefix, ...args])
run('workflow semantics', 'go', [
  'run',
  'github.com/rhysd/actionlint/cmd/actionlint@v1.7.10',
  '.github/workflows/staging-deploy.yml',
  '.github/workflows/staging-rollback.yml',
  '.github/workflows/staging-baseline-capture.yml',
])
run('git diff hygiene', git, ['diff', '--check'])

if (phase === 'deployed') await assertDeployed(head)

log(`PASS ${phase} phase for ${head}`)
