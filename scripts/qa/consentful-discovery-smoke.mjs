#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

const checks = [
  [
    'Pod consent contract',
    'packages/solid-pod-sync/src/contracts/ConsentfulDiscoveryContract.ts',
    /nearbyPresence/,
  ],
  [
    'Directory durable store',
    'packages/jss-provisioner/src/communityDirectoryPersistence.ts',
    /shouldReplaceDirectoryRecord/,
  ],
  [
    'Default-off rollout controls',
    'packages/jss-provisioner/src/milestoneQControls.ts',
    /createMilestoneQControlsFromEnv/,
  ],
  ['Directory UI', 'packages/mobile-app/app/directory.tsx', /derivePersonActionPolicy/],
  ['Profile consent UI', 'packages/mobile-app/app/profile.tsx', /updateDiscoveryPreferences/],
  ['Local transport authority', 'packages/mobile-app/app/local.tsx', /authorizeInbound/],
  ['Waku identity assertion', 'packages/waku-comms/src/types.ts', /transportIdentityAssertion/],
  ['Relay proof of possession', 'packages/relay-service/src/relayChallenge.ts', /NZ_RELAY_AUTH_V1/],
  [
    'Guarded rollback workflow',
    '.github/workflows/staging-rollback.yml',
    /Force Milestone Q flags off/,
  ],
  [
    'Registered baseline dispatcher',
    '.github/workflows/staging-deploy.yml',
    /release_action:[\s\S]*capture-baseline:[\s\S]*staging-baseline-capture\.yml/,
  ],
  ['Reusable baseline capture', '.github/workflows/staging-baseline-capture.yml', /workflow_call:/],
]

const failures = []
const sources = new Map()
for (const [label, path, pattern] of checks) {
  let source = ''
  try {
    source = await readFile(path, 'utf8')
    sources.set(path, source)
  } catch {
    failures.push(`${label}: missing ${path}`)
    continue
  }
  if (!pattern.test(source)) failures.push(`${label}: contract marker missing from ${path}`)
}

const baselineWorkflow = sources.get('.github/workflows/staging-baseline-capture.yml') ?? ''
if (/^\s*concurrency:/m.test(baselineWorkflow)) {
  failures.push('reusable baseline capture must rely on the registered caller concurrency lock')
}
if (/^\s*workflow_dispatch:/m.test(baselineWorkflow)) {
  failures.push(
    'reusable baseline capture must not expose an unregistered standalone dispatch path'
  )
}

for (const path of [
  '.github/workflows/staging-baseline-capture.yml',
  '.github/workflows/staging-rollback.yml',
]) {
  const workflow = sources.get(path) ?? (await readFile(path, 'utf8'))
  if (/list-publishing-credentials|--user\b/.test(workflow)) {
    failures.push(`${path}: Kudu capture must use short-lived Entra bearer authentication`)
  }
  if (
    !/timeout 120s az rest[\s\S]{0,300}\/api\/zip\/site\/wwwroot\/[\s\S]{0,300}--resource "https:\/\/management\.azure\.com\/"/.test(
      workflow
    )
  ) {
    failures.push(`${path}: Kudu capture is missing the ARM-audience bearer token path`)
  }
}

const rollbackWorkflow = sources.get('.github/workflows/staging-rollback.yml') ?? ''
const retainedUploadChecks = [
  [
    '.github/workflows/staging-baseline-capture.yml',
    /name: staging-baseline-\$\{\{ steps\.live\.outputs\.commit \}\}[\s\S]{0,300}include-hidden-files: true/,
  ],
  [
    '.github/workflows/staging-deploy.yml',
    /name: staging-rollback-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_attempt \}\}[\s\S]{0,300}include-hidden-files: true/,
  ],
]
for (const [path, uploadPattern] of retainedUploadChecks) {
  const workflow = sources.get(path) ?? (await readFile(path, 'utf8'))
  if (!uploadPattern.test(workflow)) {
    failures.push(`${path}: retained upload does not preserve hidden runtime assets`)
  }
}
const deployWorkflow = sources.get('.github/workflows/staging-deploy.yml') ?? ''
if (!/Baseline artifact is missing checksummed PWA file/.test(deployWorkflow)) {
  failures.push('deploy workflow: missing baseline PWA artifact completeness check')
}
if (!/Rollback artifact is missing checksummed PWA file/.test(rollbackWorkflow)) {
  failures.push('rollback workflow: missing retained PWA completeness check')
}

for (const [label, pattern] of [
  [
    'mandatory provisioner tree identity',
    /expected_provisioner_tree[\s\S]*provisioner-files\.sha256[\s\S]*authenticated-live-tree/,
  ],
  [
    'mandatory relay ZIP digest',
    /expected_relay_sha[\s\S]*\[\[ "\$expected_relay_sha" =~ \^\[0-9a-f\]\{64\}\$ \]\]/,
  ],
  ['exact live relay tree comparison', /cmp --silent[\s\S]*relay-files\.sha256/],
  [
    'legacy relay health gate',
    /Legacy retained relay bytes matched, but the service did not become healthy/,
  ],
  [
    'relay verification provenance branch',
    /relay_provenance=.*components\.relay\.provenance[\s\S]*if \[ "\$relay_provenance" = "kudu-deployment-tree" \]/,
  ],
]) {
  if (!pattern.test(rollbackWorkflow)) failures.push(`rollback workflow: missing ${label}`)
}

if (
  !/provisioner-confirm\.zip[\s\S]*Provisioner live tree changed between captures/.test(
    baselineWorkflow
  )
) {
  failures.push('baseline workflow: missing duplicate provisioner live-tree fence')
}

if (
  !/RUNNER_TEMP[\s\S]*Verify backend captures survived source checkout[\s\S]*Captured backend file is missing after source checkout/.test(
    baselineWorkflow
  )
) {
  failures.push('baseline workflow: captured backend files are not guarded across source checkout')
}

if (
  !/Capture and verify exact live PWA graph/.test(baselineWorkflow) ||
  !/--max-redirs 0[\s\S]*url_effective/.test(baselineWorkflow) ||
  !/extractExpoAssetPaths/.test(baselineWorkflow) ||
  !/Retained PWA is missing runtime asset/.test(baselineWorkflow)
) {
  failures.push(
    'baseline workflow: live PWA graph is not path-bounded, revision-authenticated, and runtime-complete'
  )
}

for (const path of [
  '.github/workflows/staging-baseline-capture.yml',
  '.github/workflows/staging-deploy.yml',
  '.github/workflows/staging-rollback.yml',
]) {
  const workflow = sources.get(path) ?? (await readFile(path, 'utf8'))
  if (!/pwa-files\.sha256/.test(workflow) || !/! -name staticwebapp\.config\.json/.test(workflow)) {
    failures.push(`${path}: public PWA checksum must exclude deployment-only SWA configuration`)
  }
}

for (const path of [
  '.github/workflows/staging-baseline-capture.yml',
  '.github/workflows/staging-deploy.yml',
  '.github/workflows/staging-rollback.yml',
]) {
  const workflow = sources.get(path) ?? (await readFile(path, 'utf8'))
  const directCurlCount = (workflow.match(/\bcurl\b/g) ?? []).length
  const directFetchCount = (workflow.match(/\bfetch\(/g) ?? []).length
  const allowedCurlCount = path.endsWith('staging-baseline-capture.yml') ? 1 : 0
  const allowedFetchCount = path.endsWith('staging-baseline-capture.yml') ? 1 : 0
  if (directCurlCount !== allowedCurlCount || directFetchCount !== allowedFetchCount) {
    failures.push(
      `${path}: release HTTP reads must use fetch-exact except the guarded PWA fetch helpers`
    )
  }
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
for (const script of [
  'policy:validate-consentful-discovery',
  'qa:smoke:community-directory',
  'qa:q4:preflight',
  'qa:q4:candidate',
  'qa:q4:published',
  'qa:q4:deployed',
]) {
  if (typeof packageJson.scripts?.[script] !== 'string')
    failures.push(`missing root script '${script}'`)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[consentful-discovery-smoke] FAIL: ${failure}`)
  process.exit(1)
}

console.log(
  `[consentful-discovery-smoke] PASS: ${checks.length} implementation boundaries and 6 release gates present`
)
