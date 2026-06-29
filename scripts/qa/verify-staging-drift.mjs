#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function extractContractIds(contractsPath) {
  const raw = fs.readFileSync(contractsPath, 'utf8')
  try {
    const parsed = JSON.parse(raw)
    return {
      factory: parsed.contracts?.lockboxFactory?.id ?? '',
      identity: parsed.contracts?.identity?.id ?? '',
      lockbox: parsed.contracts?.lockbox?.id ?? '',
    }
  } catch {
    const findAfter = (anchor) => {
      const idx = raw.indexOf(anchor)
      if (idx < 0) return ''
      const tail = raw.slice(idx)
      const match = tail.match(/"id"\s*:\s*"([A-Z0-9]{56})"/)
      return match ? match[1] : ''
    }

    return {
      identity: findAfter('"identity"'),
      lockbox: findAfter('"lockbox"'),
      factory: findAfter('"lockboxFactory"'),
    }
  }
}

function latestEntryBundle(distDir) {
  const entries = fs
    .readdirSync(distDir)
    .filter((f) => /^entry-.*\.js$/.test(f))
    .map((f) => {
      const fullPath = path.join(distDir, f)
      return { file: fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  if (entries.length === 0) {
    throw new Error(`No entry-*.js files found in ${distDir}`)
  }

  return entries[0].file
}

function parseExpoManifestFromBundle(bundlePath) {
  const src = fs.readFileSync(bundlePath, 'utf8')
  const marker = 'get manifest(){return"'
  const startIdx = src.indexOf(marker)

  if (startIdx < 0) {
    throw new Error('Expo manifest marker not found in bundle')
  }

  const start = startIdx + marker.length
  const end = src.indexOf('"},get manifest2()', start)

  if (end < 0) {
    throw new Error('Expo manifest end marker not found in bundle')
  }

  const escapedManifest = src.slice(start, end)
  const manifestJson = escapedManifest.replace(/\\"/g, '"')
  return JSON.parse(manifestJson)
}

function getProvisionerSettings(resourceGroup, appName) {
  const output = execFileSync(
    'az',
    ['webapp', 'config', 'appsettings', 'list', '--resource-group', resourceGroup, '--name', appName, '-o', 'json'],
    { encoding: 'utf8' }
  )

  const raw = JSON.parse(output)
  const map = {}
  for (const item of raw) {
    map[item.name] = item.value
  }
  return map
}

function maybeGetProvisionerSettings(resourceGroup, appName) {
  try {
    return { settings: getProvisionerSettings(resourceGroup, appName), error: null }
  } catch (error) {
    return { settings: null, error: String(error instanceof Error ? error.message : error) }
  }
}

function main() {
  const root = process.cwd()
  const contractIds = extractContractIds(path.join(root, 'deployments', 'stellar-testnet.contracts.json'))
  const expected = {
    factory: contractIds.factory,
    identity: contractIds.identity,
    lockbox: contractIds.lockbox,
    zkArtifactsUrl: process.env.NZ_ZK_ARTIFACTS_URL ?? 'https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/',
    zkManifestUrl:
      process.env.NZ_ZK_MANIFEST_URL ??
      'https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/zk-testnet-artifacts.json',
    jssProvisionerUrl:
      process.env.NZ_JSS_PROVISIONER_URL ??
      'https://nodezero-social-staging-testnet-provisioner.azurewebsites.net',
  }

  if (!expected.factory || !expected.identity || !expected.lockbox) {
    throw new Error('Could not extract canonical contract IDs from deployments/stellar-testnet.contracts.json')
  }

  const distDir = path.join(root, 'packages', 'mobile-app', 'dist', '_expo', 'static', 'js', 'web')
  const entryFile = latestEntryBundle(distDir)
  const manifest = parseExpoManifestFromBundle(entryFile)
  const actual = {
    factory: manifest.extra?.lockboxFactoryContractId ?? '',
    identity: manifest.extra?.identityContractId ?? '',
    lockbox: manifest.extra?.lockboxContractId ?? '',
    zkArtifactsUrl: manifest.extra?.zkArtifactsUrl ?? '',
    zkManifestUrl: manifest.extra?.zkManifestUrl ?? '',
    jssProvisionerUrl: manifest.extra?.jssProvisionerUrl ?? '',
  }

  const diffs = []
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (actual[key] !== expectedValue) {
      diffs.push({ key, expected: expectedValue, actual: actual[key] })
    }
  }

  const rg = process.env.STAGING_RESOURCE_GROUP ?? 'rg-nodezero-social-staging-testnet'
  const provisionerName =
    process.env.STAGING_PROVISIONER_APP ?? 'nodezero-social-staging-testnet-provisioner'
  const { settings, error } = maybeGetProvisionerSettings(rg, provisionerName)

  const provisionerChecks = []
  if (settings) {
    const provisionerExpected = {
      JSS_LOCKBOX_FACTORY_CONTRACT_ID: expected.factory,
      NZ_LOCKBOX_FACTORY_CONTRACT_ID: expected.factory,
      NZ_ZK_MANIFEST_URL: expected.zkManifestUrl,
      JSS_STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
      JSS_STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    }

    for (const [name, expectedValue] of Object.entries(provisionerExpected)) {
      const actualValue = settings[name] ?? ''
      if (actualValue !== expectedValue) {
        provisionerChecks.push({ key: name, expected: expectedValue, actual: actualValue })
      }
    }
  }

  const report = {
    entryFile,
    expected,
    actual,
    bundleDiffs: diffs,
    provisionerCompared: Boolean(settings),
    provisionerCheckDiffs: provisionerChecks,
    provisionerReadError: error,
  }

  console.log(JSON.stringify(report, null, 2))

  if (diffs.length > 0 || provisionerChecks.length > 0) {
    process.exit(2)
  }
}

main()