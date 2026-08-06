import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Keypair, Networks } from '@stellar/stellar-sdk'
import {
  assertBootstrapTarget,
  captureRequestAudit,
  deriveCohort,
  githubSecretArgs,
  hasIncompleteExternalAudit,
  isCssHost,
  validateFreshBrowserSession,
  validateRecoveryBundle,
} from './bootstrap-directory-cohort.mjs'

void test('contains request-header failures after a browser context closes', async () => {
  const audit = await captureRequestAudit({
    url: () => 'https://staging.nodezero.social/profile',
    postData: () => null,
    headers: () => ({ 'x-audit-fallback': 'fallback-value' }),
    allHeaders: () => Promise.reject(new Error('Target page has been closed')),
  })
  assert.deepEqual(audit, {
    auditFailed: true,
    hostname: 'staging.nodezero.social',
    protocol: 'https:',
    method: '',
    resourceType: '',
    hasAuthorization: false,
    surfaces: ['https://staging.nodezero.social/profile', '', 'fallback-value'],
  })
})

void test('contains synchronous request-audit failures without request data', async () => {
  const audit = await captureRequestAudit({
    url: () => {
      throw new Error('Request is unavailable')
    },
  })
  assert.deepEqual(audit, {
    auditFailed: true,
    hostname: '',
    protocol: '',
    method: '',
    resourceType: '',
    hasAuthorization: false,
    surfaces: [],
  })
})

void test('bounds a request-header audit that never settles', async () => {
  const audit = await captureRequestAudit(
    {
      url: () => 'https://staging.nodezero.social/profile',
      postData: () => null,
      allHeaders: () => new Promise(() => {}),
    },
    5
  )
  assert.equal(audit.auditFailed, true)
  assert.equal(audit.hostname, 'staging.nodezero.social')
})

void test('requires complete full headers only beyond credential origins', () => {
  const audits = [
    { auditFailed: true, hostname: 'api.nodezero.social' },
    { auditFailed: false, hostname: 'cdn.example.test' },
  ]
  const credentialOrigins = new Set(['api.nodezero.social'])
  assert.equal(hasIncompleteExternalAudit(audits, credentialOrigins), false)
  audits.push({ auditFailed: true, hostname: 'cdn.example.test' })
  assert.equal(hasIncompleteExternalAudit(audits, credentialOrigins), true)
})

function sessionCookie(token) {
  return {
    name: '__Host-nz_browser_session',
    value: token,
    domain: 'api.nodezero.social',
    path: '/',
    httpOnly: true,
    secure: true,
    expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    sameSite: 'Lax',
  }
}

void test('accepts one freshly minted opaque browser session', () => {
  assert.equal(validateFreshBrowserSession([sessionCookie('opaque-session')]), 'opaque-session')
})

void test('rejects duplicate and non-secure browser sessions', () => {
  const cookie = sessionCookie('opaque-session')
  assert.throws(() => validateFreshBrowserSession([cookie, cookie]), /one secure opaque/)
  assert.throws(
    () => validateFreshBrowserSession([{ ...cookie, httpOnly: false }]),
    /one secure opaque/
  )
})

void test('binds recovery key material to the staging account', () => {
  const keypair = Keypair.random()
  const webId = 'https://solid.nodezero.social/example/profile/card#me'
  const recoveryBundle = JSON.stringify({
    bundleVersion: 1,
    envProfile: 'staging-testnet',
    stellarNetworkPassphrase: Networks.TESTNET,
    webId,
    wallet: { publicKey: keypair.publicKey(), secretKey: keypair.secret() },
  })
  assert.deepEqual(validateRecoveryBundle(recoveryBundle, webId), {
    webId,
    publicKey: keypair.publicKey(),
  })
  assert.throws(
    () => validateRecoveryBundle(recoveryBundle, `${webId}-other`),
    /expected staging account/
  )
})

void test('derives only the two selected cohort hashes', () => {
  const cohort = deriveCohort(
    ['https://example.test/a#me', 'https://example.test/b#me', 'https://example.test/c#me'],
    'fixed-test-key-that-is-at-least-thirty-two-characters'
  )
  assert.equal(cohort.hashes.length, 2)
  assert.equal(new Set(cohort.hashes).size, 2)
  assert.match(cohort.hashes[0], /^[0-9a-f]{64}$/)
})

void test('pins bootstrap targets to staging-testnet', () => {
  const target = {
    baseUrl: 'https://staging.nodezero.social',
    repository: 'lockb0x-llc/nodezero-social',
    environment: 'staging-testnet',
    solidHost: 'solid.nodezero.social',
  }
  assert.doesNotThrow(() => assertBootstrapTarget(target))
  assert.throws(
    () => assertBootstrapTarget({ ...target, baseUrl: 'https://nodezero.social' }),
    /non-staging/
  )
  assert.throws(
    () => assertBootstrapTarget({ ...target, environment: 'production-mainnet' }),
    /non-staging/
  )
})

void test('embargoes the CSS origin and every subdomain', () => {
  assert.equal(isCssHost('solid.nodezero.social', 'solid.nodezero.social'), true)
  assert.equal(isCssHost('alice.solid.nodezero.social', 'solid.nodezero.social'), true)
  assert.equal(isCssHost('api.nodezero.social', 'solid.nodezero.social'), false)
})

void test('streams GitHub secret values through stdin instead of body arguments', () => {
  const args = githubSecretArgs('lockb0x-llc/nodezero-social', 'staging-testnet', 'SECRET')
  assert.equal(args.includes('--body'), false)
  assert.equal(args.includes('-'), false)
})
