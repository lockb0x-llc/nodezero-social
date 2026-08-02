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
]

const failures = []
for (const [label, path, pattern] of checks) {
  let source = ''
  try {
    source = await readFile(path, 'utf8')
  } catch {
    failures.push(`${label}: missing ${path}`)
    continue
  }
  if (!pattern.test(source)) failures.push(`${label}: contract marker missing from ${path}`)
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
