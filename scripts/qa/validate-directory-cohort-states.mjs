#!/usr/bin/env node

import { Keypair, Networks } from '@stellar/stellar-sdk'
import { createHmac } from 'node:crypto'

function parseRecoveryBundle(name) {
  const bundle = JSON.parse(process.env[name] ?? '')
  if (
    bundle?.bundleVersion !== 1 ||
    bundle.envProfile !== 'staging-testnet' ||
    bundle.stellarNetworkPassphrase !== Networks.TESTNET
  ) {
    throw new Error(`${name} is not a staging-testnet recovery bundle.`)
  }
  let webId
  try {
    webId = new URL(bundle.webId)
  } catch {
    throw new Error(`${name} has an invalid WebID.`)
  }
  if (
    webId.protocol !== 'https:' ||
    webId.hostname !== 'solid.nodezero.social' ||
    webId.hash !== '#me'
  ) {
    throw new Error(`${name} has an unexpected WebID origin or subject.`)
  }
  const publicKey = bundle.wallet?.publicKey
  const secretKey = bundle.wallet?.secretKey
  if (
    typeof publicKey !== 'string' ||
    !/^G[A-Z2-7]{55}$/.test(publicKey) ||
    typeof secretKey !== 'string' ||
    !/^S[A-Z2-7]{55}$/.test(secretKey) ||
    Keypair.fromSecret(secretKey).publicKey() !== publicKey
  ) {
    throw new Error(`${name} contains invalid or mismatched Stellar key material.`)
  }
  return { webId: webId.href, publicKey }
}

const configuredHashes = (process.env.JSS_Q_COHORT_HASHES ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)
if (
  configuredHashes.length !== 2 ||
  configuredHashes[0] === configuredHashes[1] ||
  configuredHashes.some((value) => !/^[0-9a-f]{64}$/.test(value))
) {
  throw new Error('Exactly two distinct lowercase SHA-256 cohort hashes are required.')
}
const cohortKey = (process.env.JSS_Q_COHORT_KEY ?? '').trim()
if (cohortKey.length < 32) throw new Error('Directory cohort HMAC key is too short.')

const recoveries = [
  parseRecoveryBundle('DIRECTORY_ACCOUNT_A_RECOVERY_BUNDLE'),
  parseRecoveryBundle('DIRECTORY_ACCOUNT_B_RECOVERY_BUNDLE'),
  parseRecoveryBundle('DIRECTORY_NON_COHORT_RECOVERY_BUNDLE'),
]
if (new Set(recoveries.map(({ webId }) => webId)).size !== 3) {
  throw new Error('Directory E2E artifacts must contain three distinct WebIDs.')
}
if (new Set(recoveries.map(({ publicKey }) => publicKey)).size !== 3) {
  throw new Error('Directory E2E artifacts must contain three distinct device identities.')
}

const derivedHashes = recoveries.map(({ webId }) =>
  createHmac('sha256', cohortKey).update(webId).digest('hex')
)
if (derivedHashes.slice(0, 2).sort().join(',') !== [...configuredHashes].sort().join(',')) {
  throw new Error('Configured hashes do not match the two cohort recovery accounts.')
}
if (configuredHashes.includes(derivedHashes[2])) {
  throw new Error('The non-cohort recovery account is included in the cohort.')
}

process.stdout.write('Directory cohort recovery artifacts validated.\n')
