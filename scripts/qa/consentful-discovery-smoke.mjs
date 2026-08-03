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

const podProxySource = await readFile('packages/jss-provisioner/src/podProxy.ts', 'utf8')
for (const auditCall of podProxySource.matchAll(/auditLog\?\.\([\s\S]*?\}\)/g)) {
  if (/\b(webId|target|message)\s*:/.test(auditCall[0])) {
    failures.push('Pod proxy audit events must not emit raw identity, resource, or error fields')
  }
}
if (!/identityDigest[\s\S]*resourceDigest/.test(podProxySource)) {
  failures.push('Pod proxy audit events are missing irreversible identity/resource digests')
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
if (
  !/runtime\/package-lock\.json[\s\S]*npm ci --prefix flat-runtime\/dist[\s\S]*dist\/node_modules\/@nodezero\/solid-pod-sync[\s\S]*--ignore-stack true/.test(
    deployWorkflow
  )
) {
  failures.push(
    'deploy workflow: standalone provisioner artifact is not optimizer-safe and lockfile-backed'
  )
}
if (
  !/Build and package relay service[\s\S]*runtime\/package-lock\.json[\s\S]*npm ci --prefix flat-runtime\/dist[\s\S]*@stellar\/stellar-sdk[\s\S]*smol-toml[\s\S]*test -z[\s\S]*hash-relay-payload\.mjs[\s\S]*flat-runtime\/build-info\.json[\s\S]*healthCheckPath.*\/healthz[\s\S]*packages\/relay-service\/flat-runtime[\s\S]*relay-files\.sha256/.test(
    deployWorkflow
  )
) {
  failures.push(
    'deploy workflow: standalone relay artifact is not optimizer-inert and lockfile-backed'
  )
}
if (
  !/Wait for provisioner SCM stabilization[\s\S]*consecutive_ready=0[\s\S]*\/api\/deployments[\s\S]*consecutive_ready=\$\(\(consecutive_ready \+ 1\)\)[\s\S]*"\$consecutive_ready" -eq 3[\s\S]*consecutive_ready=0[\s\S]*Final provisioner SCM probe error[\s\S]*stability threshold was not reached[\s\S]*--async true[\s\S]*--restart false[\s\S]*if deployments="\$\(timeout 20s az rest[\s\S]*"\$status" = "4" \] && \[ "\$complete" = "true"[\s\S]*Kudu deployment status polling failed; retrying[\s\S]*print_deployment_diagnostics[\s\S]*Provisioner Kudu deployment did not reach terminal success[\s\S]*Activate JSS provisioner artifact provenance/.test(
    deployWorkflow
  )
) {
  failures.push(
    'deploy workflow: provisioner bytes and provenance are not activated in a restart-safe order'
  )
}
if (
  !/Verify JSS provisioner health[\s\S]*health_deadline=\$\(\(SECONDS \+ 600\)\)[\s\S]*health_contract_matches\(\)[\s\S]*\.build\.commit == \$commit[\s\S]*\.build\.payloadSha256 == \$payload[\s\S]*\.build\.configuredArtifactSha256 == \$artifact[\s\S]*\.communityDirectory\.backend == "table"[\s\S]*\.communityDirectory\.ready == true[\s\S]*\.transportIdentity\.ready == true[\s\S]*\.session\.signingKeyConfigured == true[\s\S]*\.milestoneQ\.flags\.directory == false[\s\S]*\.milestoneQ\.flags\["peer-profile"\] == false[\s\S]*\.milestoneQ\.flags\.relationship == false[\s\S]*\.milestoneQ\.flags\.transport == false[\s\S]*while \(\( SECONDS < health_deadline \)\)[\s\S]*fetch_timeout_ms=\$\(\(remaining_seconds \* 1000\)\)[\s\S]*fetch_timeout_ms > 10000[\s\S]*NZ_FETCH_TIMEOUT_MS="\$fetch_timeout_ms"[\s\S]*if health_contract_matches \/tmp\/provisioner-health\.json[\s\S]*consecutive_healthy=\$\(\(consecutive_healthy \+ 1\)\)[\s\S]*"\$consecutive_healthy" -eq 3[\s\S]*remaining_seconds < 40[\s\S]*sleep 30[\s\S]*! health_contract_matches \/tmp\/provisioner-stable-health\.json[\s\S]*SECONDS > health_deadline[\s\S]*print_health_diagnostics \/tmp\/provisioner-stable-health\.json[\s\S]*600-second deadline/.test(
    deployWorkflow
  )
) {
  failures.push(
    'deploy workflow: provisioner readiness is not bounded by the guarded ten-minute stability contract'
  )
}
if (
  !/Configure relay service runtime[\s\S]*Wait for relay SCM stabilization[\s\S]*consecutive_ready=0[\s\S]*\/api\/deployments[\s\S]*"\$consecutive_ready" -eq 3[\s\S]*Deploy relay service bytes[\s\S]*before_id=[\s\S]*--ignore-stack true[\s\S]*--async true[\s\S]*--restart false[\s\S]*--track-status false[\s\S]*deployment_url="\$\{deployment_url\}\/\$\{deployment_id\}"[\s\S]*"\$latest_id" != "\$before_id"[\s\S]*"\$status" = "4" \] && \[ "\$complete" = "true"[\s\S]*"\$status" = "3"[\s\S]*print_deployment_diagnostics[\s\S]*Relay Kudu deployment status polling failed; retrying[\s\S]*Relay Kudu deployment did not reach terminal success[\s\S]*Activate relay service bytes[\s\S]*az webapp restart[\s\S]*Verify relay health and identity verifier configuration/.test(
    deployWorkflow
  )
) {
  failures.push('deploy workflow: relay bytes are not copied and activated in a restart-safe order')
}
const relayDeploymentBlock = deployWorkflow.match(
  /- name: Deploy relay service bytes[\s\S]*?- name: Activate relay service bytes/
)?.[0]
const relayDeploymentAssignments = relayDeploymentBlock?.match(/^\s*deployment_id\s*=/gm) ?? []
if (
  relayDeploymentAssignments.length !== 2 ||
  !/^\s*deployment_id=""$/m.test(relayDeploymentBlock ?? '') ||
  !/^\s*deployment_id="\$latest_id"$/m.test(relayDeploymentBlock ?? '')
) {
  failures.push('deploy workflow: relay Kudu deployment ID is not assigned exactly once')
}
const relayHealthBlock = deployWorkflow.match(
  /- name: Verify relay health and identity verifier configuration[\s\S]*?(?=\n\s{6}- name:)/
)?.[0]
const relayHealthLines = new Set((relayHealthBlock ?? '').split('\n').map((line) => line.trim()))
for (const predicate of [
  `[ "$(jq -r '.identityVerifierConfigured // false' /tmp/relay-health.json)" = "true" ] && \\`,
  `[ "$(jq -r '.identityVerifierReachable // false' /tmp/relay-health.json)" = "true" ] && \\`,
  `[ "$(jq -r '.transportEnabled // true' /tmp/relay-health.json)" = "false" ] && \\`,
  `[ "$(jq -r '.build.commit // empty' /tmp/relay-health.json)" = "$EXPECTED_COMMIT" ] && \\`,
  `[ "$(jq -r '.build.payloadSha256 // empty' /tmp/relay-health.json)" = "$EXPECTED_PAYLOAD_SHA256" ]; then`,
]) {
  if (!relayHealthLines.has(predicate)) {
    failures.push(`deploy workflow: missing exact relay health predicate: ${predicate}`)
  }
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
  'qa:validate:provisioner-runtime',
  'qa:validate:production-audit',
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
