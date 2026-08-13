/**
 * CredentialStore + SessionTokenManager unit tests.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ConditionalWriteError,
  CredentialStore,
  encryptSecret,
  decryptSecret,
  webIdRowKey,
} from './credentialStore.js'
import { SessionTokenManager } from './sessionTokens.js'

const KEY_B64 = randomBytes(32).toString('base64')

// ---------------------------------------------------------------------------
// Encryption primitives
// ---------------------------------------------------------------------------

void test('encryptSecret/decryptSecret round-trips and authenticates', () => {
  const key = randomBytes(32)
  const secret = 'client-secret-material-##'
  const ciphertext = encryptSecret(key, secret)
  assert.notEqual(ciphertext, secret)
  assert.equal(decryptSecret(key, ciphertext), secret)

  // Tampering must fail the GCM tag.
  const tampered = Buffer.from(ciphertext, 'base64')
  tampered[tampered.length - 1] ^= 0xff
  assert.throws(() => decryptSecret(key, tampered.toString('base64')))

  // A different key must fail.
  assert.throws(() => decryptSecret(randomBytes(32), ciphertext))
})

void test('webIdRowKey is deterministic and table-safe', () => {
  const a = webIdRowKey('https://solid.nodezero.social/alice/profile/card#me')
  const b = webIdRowKey('https://solid.nodezero.social/alice/profile/card#me')
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
})

// ---------------------------------------------------------------------------
// Store backends
// ---------------------------------------------------------------------------

void test('memory store: save, find, revoke lifecycle', async () => {
  const store = new CredentialStore({ encryptionKey: KEY_B64 })
  assert.equal(store.backendKind, 'memory')

  await store.save({
    webId: 'https://pods.example/alice/profile/card#me',
    podUrl: 'https://pods.example/alice/',
    stellarPublicKey: 'GABC',
    clientCredentialsId: 'cc-1',
    clientCredentialsSecret: 'super-secret',
    userLockboxContractId: 'CLOCKBOX',
    lockboxFactoryContractId: 'CFACTORY',
    proofRootHex: 'ab'.repeat(32),
  })

  const found = await store.findByWebId('https://pods.example/alice/profile/card#me')
  assert.ok(found)
  assert.equal(found.clientCredentialsSecret, 'super-secret')
  assert.equal(found.podUrl, 'https://pods.example/alice/')
  assert.equal(found.userLockboxContractId, 'CLOCKBOX')

  // Stellar-key index resolves to the same record.
  const byKey = await store.findByStellarPublicKey('GABC')
  assert.ok(byKey)
  assert.equal(byKey.webId, 'https://pods.example/alice/profile/card#me')

  await store.save({
    webId: 'https://pods.example/alice-second/profile/card#me',
    podUrl: 'https://pods.example/alice-second/',
    stellarPublicKey: 'GABC',
    clientCredentialsId: 'cc-2',
    clientCredentialsSecret: 'second-secret',
    userLockboxContractId: null,
    lockboxFactoryContractId: null,
    proofRootHex: null,
  })

  const byKeyAll = await store.findAllByStellarPublicKey('GABC')
  assert.equal(byKeyAll.length, 2)
  assert.equal(byKeyAll[0]?.webId, 'https://pods.example/alice-second/profile/card#me')
  assert.equal(byKeyAll[1]?.webId, 'https://pods.example/alice/profile/card#me')

  assert.equal(await store.revokeByWebId('https://pods.example/alice/profile/card#me'), true)
  assert.equal(await store.findByWebId('https://pods.example/alice/profile/card#me'), null)
  const remaining = await store.findByStellarPublicKey('GABC')
  assert.ok(remaining)
  assert.equal(remaining.webId, 'https://pods.example/alice-second/profile/card#me')

  assert.equal(await store.revokeByWebId('https://pods.example/alice-second/profile/card#me'), true)
  assert.equal(await store.findByStellarPublicKey('GABC'), null)
  assert.equal(await store.revokeByWebId('https://pods.example/alice/profile/card#me'), false)
})

void test('file store: persists across instances with the same key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nz-credstore-'))
  const filePath = join(dir, 'credentials.json')
  try {
    const first = new CredentialStore({ encryptionKey: KEY_B64, filePath })
    assert.equal(first.backendKind, 'file')
    await first.save({
      webId: 'https://pods.example/bob/profile/card#me',
      podUrl: 'https://pods.example/bob/',
      stellarPublicKey: null,
      clientCredentialsId: 'cc-2',
      clientCredentialsSecret: 'file-secret',
      userLockboxContractId: null,
      lockboxFactoryContractId: null,
      proofRootHex: null,
    })

    const second = new CredentialStore({ encryptionKey: KEY_B64, filePath })
    const found = await second.findByWebId('https://pods.example/bob/profile/card#me')
    assert.ok(found)
    assert.equal(found.clientCredentialsSecret, 'file-secret')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

void test('memory store: conditional rows reject duplicate creates and stale ETags', async () => {
  const store = new CredentialStore({ encryptionKey: KEY_B64 })
  const firstEtag = await store.createVersionedRow('operation-1', { state: 'reserved' })
  await assert.rejects(
    store.createVersionedRow('operation-1', { state: 'reserved' }),
    (error: unknown) => error instanceof ConditionalWriteError && error.code === 'already_exists'
  )

  const secondEtag = await store.replaceVersionedRow(
    'operation-1',
    { state: 'proof_verified' },
    firstEtag
  )
  await assert.rejects(
    store.replaceVersionedRow('operation-1', { state: 'completed' }, firstEtag),
    (error: unknown) => error instanceof ConditionalWriteError && error.code === 'etag_mismatch'
  )
  await assert.rejects(
    store.deleteVersionedRow('operation-1', firstEtag),
    (error: unknown) => error instanceof ConditionalWriteError && error.code === 'etag_mismatch'
  )
  assert.equal(await store.deleteVersionedRow('operation-1', secondEtag), true)
})

void test('file store: ETags persist across instances and fence stale writers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nz-credstore-etag-'))
  const filePath = join(dir, 'credentials.json')
  try {
    const first = new CredentialStore({ encryptionKey: KEY_B64, filePath })
    const originalEtag = await first.createVersionedRow('operation-2', { state: 'reserved' })

    const second = new CredentialStore({ encryptionKey: KEY_B64, filePath })
    const loaded = await second.readVersionedRow('operation-2')
    assert.equal(loaded?.etag, originalEtag)
    assert.equal(loaded?.value.state, 'reserved')

    const currentEtag = await second.replaceVersionedRow(
      'operation-2',
      { state: 'proof_verified' },
      originalEtag
    )
    await assert.rejects(
      first.replaceVersionedRow('operation-2', { state: 'completed' }, originalEtag),
      (error: unknown) => error instanceof ConditionalWriteError && error.code === 'etag_mismatch'
    )
    assert.equal(await second.deleteVersionedRow('operation-2', currentEtag), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

void test('memory store: ignores obsolete stellar-key index shapes', async () => {
  const store = new CredentialStore({ encryptionKey: KEY_B64 })
  await store.createVersionedRow('spk:GOLDSTYLE', {
    webId: 'https://pods.example/oldstyle/profile/card#me',
    webIds: ['https://pods.example/oldstyle/profile/card#me'],
  })

  assert.equal(await store.findByStellarPublicKey('GOLDSTYLE'), null)
  assert.deepEqual(await store.findAllByStellarPublicKey('GOLDSTYLE'), [])
})

void test('durable backend without an encryption key fails closed at construction', () => {
  assert.throws(
    () => new CredentialStore({ filePath: 'c:/tmp/never-created.json' }),
    /JSS_CREDENTIALS_ENC_KEY/
  )
  assert.throws(
    () => new CredentialStore({ tableSasUrl: 'https://acct.table.core.windows.net/creds?sig=abc' }),
    /JSS_CREDENTIALS_ENC_KEY/
  )
})

void test('table backend requires a signed SAS URL', () => {
  assert.throws(
    () =>
      new CredentialStore({
        encryptionKey: KEY_B64,
        tableSasUrl: 'https://acct.table.core.windows.net/creds',
      }),
    /SAS/
  )
})

// ---------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------

void test('session: issue/verify round-trip carries identity claims', () => {
  const manager = new SessionTokenManager({
    signingKey: 'k'.repeat(32),
    issuer: 'https://staging.nodezero.social',
  })
  const session = manager.issue({
    webId: 'https://pods.example/carol/profile/card#me',
    podUrl: 'https://pods.example/carol/',
    stellarPublicKey: 'GDEF',
  })

  const claims = manager.verify(session.accessToken)
  assert.ok(claims)
  assert.equal(claims.sub, 'https://pods.example/carol/profile/card#me')
  assert.equal(claims.pod, 'https://pods.example/carol/')
  assert.equal(claims.spk, 'GDEF')
  assert.equal(claims.aud, 'nz-session-v1')
})

void test('session: verification rejects tampered, foreign, and expired tokens', () => {
  const manager = new SessionTokenManager({ signingKey: 'k'.repeat(32) })
  const other = new SessionTokenManager({ signingKey: 'x'.repeat(32) })
  const session = manager.issue({ webId: 'https://w/e#me', podUrl: 'https://w/e/' })

  // Tampered payload.
  const [h, , s] = session.accessToken.split('.')
  const forgedPayload = Buffer.from(
    JSON.stringify({ sub: 'https://evil', aud: 'nz-session-v1', exp: 9999999999 })
  ).toString('base64url')
  assert.equal(manager.verify(`${h}.${forgedPayload}.${s}`), null)

  // Signed by a different key.
  assert.equal(other.verify(session.accessToken), null)

  // Expired.
  const shortLived = new SessionTokenManager({ signingKey: 'k'.repeat(32), accessTtlMs: -1000 })
  const expired = shortLived.issue({ webId: 'https://w/e#me', podUrl: 'https://w/e/' })
  assert.equal(shortLived.verify(expired.accessToken), null)

  // Garbage.
  assert.equal(manager.verify('not-a-token'), null)
  assert.equal(manager.verify(''), null)
})

void test('session: refresh tokens are single-use and revocable by webId', () => {
  const manager = new SessionTokenManager({ signingKey: 'k'.repeat(32) })
  const webId = 'https://pods.example/dave/profile/card#me'
  const s1 = manager.issue({ webId, podUrl: 'https://pods.example/dave/' })
  const s2 = manager.issue({ webId, podUrl: 'https://pods.example/dave/' })

  const identity = manager.consumeRefreshToken(s1.refreshToken)
  assert.ok(identity)
  assert.equal(identity.webId, webId)
  // Replay fails.
  assert.equal(manager.consumeRefreshToken(s1.refreshToken), null)

  // Revoke-by-webId kills the remaining token.
  assert.equal(manager.revokeByWebId(webId), 1)
  assert.equal(manager.consumeRefreshToken(s2.refreshToken), null)
})
