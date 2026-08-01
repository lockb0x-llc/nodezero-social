#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifestPath = resolve(root, 'docs/qa/consentful-discovery-security-vectors.json')
const requiredCategories = new Set([
  'inbox-acl',
  'inbox-flood',
  'rate-limit',
  'external-fetch',
  'credential-boundary',
  'replay',
  'sender-verification',
  'privacy',
  'migration',
  'block-precedence',
])

const failures = []
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.version !== 1) failures.push('Security vector manifest version must be 1.')
if (manifest.milestone !== 'Q1C') failures.push('Security vector manifest must target Q1C.')
if (!Array.isArray(manifest.vectors)) failures.push('Security vector manifest must contain vectors.')

const ids = new Set()
const categories = new Set()
for (const vector of manifest.vectors ?? []) {
  if (typeof vector.id !== 'string' || !/^Q1C-[A-Z]+-\d{3}$/.test(vector.id)) {
    failures.push(`Invalid vector id: ${String(vector.id)}`)
    continue
  }
  if (ids.has(vector.id)) failures.push(`Duplicate vector id: ${vector.id}`)
  ids.add(vector.id)
  categories.add(vector.category)
  for (const field of ['category', 'threat', 'expected', 'testFile', 'testName']) {
    if (typeof vector[field] !== 'string' || !vector[field].trim()) {
      failures.push(`${vector.id} is missing ${field}.`)
    }
  }
  const testPath = resolve(root, vector.testFile)
  try {
    const source = await readFile(testPath, 'utf8')
    if (!source.includes(vector.testName)) {
      failures.push(`${vector.id} test name is missing from ${vector.testFile}.`)
    }
  } catch {
    failures.push(`${vector.id} test file does not exist: ${vector.testFile}.`)
  }
}

for (const category of requiredCategories) {
  if (!categories.has(category)) failures.push(`Missing required security category: ${category}.`)
}
for (const category of categories) {
  if (!requiredCategories.has(category)) failures.push(`Unknown security category: ${category}.`)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[policy:consentful-discovery] FAIL: ${failure}`)
  process.exit(1)
}

const pnpmEntry = process.env.npm_execpath
if (!pnpmEntry) {
  console.error('[policy:consentful-discovery] FAIL: npm_execpath is unavailable.')
  process.exit(1)
}
const groups = [
  {
    label: 'Solid ACL, flood, replay, privacy, migration, and block vectors',
    args: [
      '--filter', '@nodezero/solid-pod-sync', 'exec', 'node',
      '--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--runInBand',
      'src/__tests__/PodLayoutManager.test.ts',
      'src/__tests__/RelationshipInboxReader.test.ts',
      'src/__tests__/RelationshipInboxProcessor.test.ts',
      'src/__tests__/ProcessedActivityManager.test.ts',
      'src/__tests__/RelationshipInboxIngestion.test.ts',
      'src/__tests__/RelationshipManager.test.ts',
      'src/__tests__/LegacyRelationshipMigrator.test.ts',
      'src/__tests__/contract-conformance.test.ts',
      'src/__tests__/DiscoveryManifestManager.test.ts',
    ],
  },
  {
    label: 'Provisioner SSRF, credential, and sender assertion vectors',
    args: [
      '--filter', '@nodezero/jss-provisioner', 'exec', 'tsx', '--test',
      'src/publicResourceFetcher.test.ts',
      'src/relationshipDeliveryAssertions.test.ts',
      'src/relationshipDelivery.test.ts',
      'src/relationshipBlockPolicy.test.ts',
      'src/relationshipRateLimiter.test.ts',
    ],
  },
  {
    label: 'Provisioner authenticated relationship route rate-limit vector',
    args: [
      '--filter', '@nodezero/jss-provisioner', 'exec', 'tsx', '--test',
      '--test-name-pattern=relationship delivery route rate limits authenticated floods',
      'src/index.session.test.ts',
    ],
  },
  {
    label: 'Provisioner authenticated verification route rate-limit vector',
    args: [
      '--filter', '@nodezero/jss-provisioner', 'exec', 'tsx', '--test',
      '--test-name-pattern=relationship verification route rate limits authenticated floods',
      'src/index.session.test.ts',
    ],
  },
  {
    label: 'Provisioner authenticated owner block route vector',
    args: [
      '--filter', '@nodezero/jss-provisioner', 'exec', 'tsx', '--test',
      '--test-name-pattern=relationship delivery route enforces the authenticated owner Pod block',
      'src/index.session.test.ts',
    ],
  },
  {
    label: 'Mobile block-precedence vectors',
    args: [
      '--filter', '@nodezero/mobile-app', 'exec', 'tsx', '--test',
      'src/social/composeRecipients.test.ts',
      'src/social/relationshipInboxSync.test.ts',
      'src/social/relationshipSenderVerifier.test.ts',
    ],
  },
]

for (const group of groups) {
  console.log(`[policy:consentful-discovery] RUN: ${group.label}`)
  const result = spawnSync(process.execPath, [pnpmEntry, ...group.args], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) {
    console.error(`[policy:consentful-discovery] FAIL: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[policy:consentful-discovery] FAIL: ${group.label}`)
    process.exit(result.status ?? 1)
  }
}

console.log(
  `[policy:consentful-discovery] PASS: ${ids.size} vectors across ${categories.size} required categories.`,
)