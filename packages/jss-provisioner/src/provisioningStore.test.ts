import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConditionalWriteError, CredentialStore } from './credentialStore.js'
import {
  computeProvisioningRequestDigest,
  decodeReservationRegistry,
  encodeReservationRegistry,
  ProvisioningConflictError,
  ProvisioningStore,
  RESERVATION_CHUNK_MAX_CHARS,
  type ProvisioningReservationInput,
} from './provisioningStore.js'

const KEY_B64 = randomBytes(32).toString('base64')

function reservationInput(
  overrides: Partial<ProvisioningReservationInput> = {}
): ProvisioningReservationInput {
  return {
    idempotencyKey: 'signup-request-1',
    requestDigest: 'a'.repeat(64),
    normalizedHandle: 'alice',
    normalizedEmail: 'alice@example.com',
    expectedWebId: 'https://solid.nodezero.social/alice/profile/card#me',
    expectedPodUrl: 'https://solid.nodezero.social/alice/',
    stellarPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    configFingerprint: 'b'.repeat(64),
    descriptorSnapshot: { circuitVersion: 3, network: 'testnet' },
    resumeMaterial: { cssPassword: 'one-time-secret', proof: { pi_a: ['1', '2'] } },
    ...overrides,
  }
}

void test('request digest is stable across recursively reordered object keys', () => {
  const first = computeProvisioningRequestDigest({
    proof: { pi_b: [['3', '4']], pi_a: ['1', '2'] },
    handle: 'alice',
  })
  const second = computeProvisioningRequestDigest({
    handle: 'alice',
    proof: { pi_a: ['1', '2'], pi_b: [['3', '4']] },
  })
  assert.equal(first, second)
  assert.notEqual(first, computeProvisioningRequestDigest({ handle: 'bob' }))
})

void test('reservation registry chunks round-trip below Azure property limits', () => {
  const reservations = Object.fromEntries(
    Array.from({ length: 120 }, (_, index) => [
      `handle:${String(index).padStart(64, '0')}`,
      {
        operationId: `op_${String(index).padStart(64, '0')}`,
        requestDigest: String(index).padStart(64, 'a'),
        disposition: 'committed',
        expiresAt: null,
      },
    ])
  )
  const encoded = encodeReservationRegistry(reservations)
  assert.equal(encoded.schemaVersion, 2)
  assert.ok(Number(encoded.reservationsChunkCount) > 1)
  for (const [key, value] of Object.entries(encoded)) {
    if (!key.startsWith('reservationsJson')) continue
    assert.equal(typeof value, 'string')
    assert.ok(String(value).length <= RESERVATION_CHUNK_MAX_CHARS)
  }
  assert.deepEqual(decodeReservationRegistry(encoded), reservations)
})

void test('old-format near-limit reservation registry upgrades on the next claim', async () => {
  const credentials = new CredentialStore({ encryptionKey: KEY_B64 })
  const oldFormatReservations = Object.fromEntries(
    Array.from({ length: 112 }, (_, index) => [
      `handle:${String(index).padStart(64, '0')}`,
      {
        operationId: `op_${String(index).padStart(64, '0')}`,
        requestDigest: String(index).padStart(64, 'b'),
        disposition: 'committed',
        expiresAt: null,
      },
    ])
  )
  await credentials.createVersionedRow('provisioning-reservations-v1', {
    schemaVersion: 1,
    reservationsJson: JSON.stringify(oldFormatReservations),
    updatedAt: new Date().toISOString(),
  })

  const store = new ProvisioningStore(credentials)
  await store.reserveOrLoad(
    reservationInput({
      idempotencyKey: 'chunk-upgrade',
      requestDigest: '9'.repeat(64),
      normalizedHandle: 'chunk-upgrade',
      normalizedEmail: 'chunk-upgrade@example.com',
      expectedWebId: 'https://solid.nodezero.social/chunk-upgrade/profile/card#me',
      expectedPodUrl: 'https://solid.nodezero.social/chunk-upgrade/',
    })
  )

  const migrated = await credentials.readVersionedRow('provisioning-reservations-v1')
  assert.equal(migrated?.value.schemaVersion, 2)
  assert.equal('reservationsJson' in (migrated?.value ?? {}), false)
  assert.ok(Number(migrated?.value.reservationsChunkCount) > 1)
})

void test('chunked registry fails closed when a chunk is missing', () => {
  assert.throws(
    () =>
      decodeReservationRegistry({
        schemaVersion: 2,
        reservationsChunkCount: 2,
        reservationsJson000: '{}',
      }),
    /chunk is missing/i
  )
})

void test('reserveOrLoad replays the same request and rejects idempotency payload drift', async () => {
  const store = new ProvisioningStore(new CredentialStore({ encryptionKey: KEY_B64 }))
  const input = reservationInput()
  const first = await store.reserveOrLoad(input)
  const replay = await store.reserveOrLoad(input)

  assert.equal(replay.operation.operationId, first.operation.operationId)
  assert.equal(replay.operation.state, 'reserved')
  await assert.rejects(
    store.reserveOrLoad({ ...input, requestDigest: 'c'.repeat(64) }),
    (error: unknown) =>
      error instanceof ProvisioningConflictError && error.code === 'idempotency_payload_conflict'
  )
})

void test('reservations exclude duplicate handles without reserving Stellar identities', async () => {
  const store = new ProvisioningStore(new CredentialStore({ encryptionKey: KEY_B64 }))
  const firstInput = reservationInput()
  await store.reserveOrLoad(firstInput)

  await assert.rejects(
    store.reserveOrLoad(
      reservationInput({
        idempotencyKey: 'signup-request-2',
        requestDigest: 'd'.repeat(64),
        normalizedEmail: 'different@example.com',
        expectedWebId: 'https://solid.nodezero.social/different/profile/card#me',
        expectedPodUrl: 'https://solid.nodezero.social/different/',
      })
    ),
    (error: unknown) =>
      error instanceof ProvisioningConflictError && error.code === 'reservation_conflict'
  )

  const second = await store.reserveOrLoad(
    reservationInput({
      idempotencyKey: 'signup-request-3',
      requestDigest: 'e'.repeat(64),
      normalizedHandle: 'alice-second',
      normalizedEmail: 'alice-second@example.com',
      expectedWebId: 'https://solid.nodezero.social/alice-second/profile/card#me',
      expectedPodUrl: 'https://solid.nodezero.social/alice-second/',
    })
  )
  assert.equal(second.operation.stellarPublicKey, firstInput.stellarPublicKey)
})

void test('resume material is encrypted and recoverable only through the store', async () => {
  const credentials = new CredentialStore({ encryptionKey: KEY_B64 })
  const store = new ProvisioningStore(credentials)
  const reserved = await store.reserveOrLoad(reservationInput())

  assert.equal(reserved.operation.encryptedResumeMaterialB64.includes('one-time-secret'), false)
  assert.deepEqual(store.decryptResumeMaterial(reserved.operation), {
    cssPassword: 'one-time-secret',
    proof: { pi_a: ['1', '2'] },
  })
})

void test('leases fence concurrent and stale writers and enforce legal transitions', async () => {
  const credentials = new CredentialStore({ encryptionKey: KEY_B64 })
  const store = new ProvisioningStore(credentials)
  const reserved = await store.reserveOrLoad(reservationInput())
  const acquired = await store.acquireLease(reserved, 'worker-a', 60_000)

  assert.notEqual(acquired.operation.operation.leaseTokenHash, acquired.lease.token)
  await assert.rejects(
    store.acquireLease(acquired.operation, 'worker-b', 60_000),
    (error: unknown) =>
      error instanceof ProvisioningConflictError && error.code === 'provisioning_in_progress'
  )

  const proofVerified = await store.transition(acquired.operation, acquired.lease, 'proof_verified')
  await assert.rejects(
    store.transition(proofVerified, acquired.lease, 'completed'),
    (error: unknown) =>
      error instanceof ProvisioningConflictError && error.code === 'illegal_transition'
  )
  await assert.rejects(
    store.transition(acquired.operation, acquired.lease, 'failed_terminal'),
    (error: unknown) => error instanceof ConditionalWriteError && error.code === 'etag_mismatch'
  )
})

void test('an expired CSS-pending lease enters manual review and cannot be reacquired', async () => {
  const credentials = new CredentialStore({ encryptionKey: KEY_B64 })
  const store = new ProvisioningStore(credentials)
  const reserved = await store.reserveOrLoad(reservationInput())
  const acquired = await store.acquireLease(reserved, 'worker-a', 60_000)
  const proofVerified = await store.transition(acquired.operation, acquired.lease, 'proof_verified')
  const cssPending = await store.transition(proofVerified, acquired.lease, 'css_account_pending')
  const expiredOperation = {
    ...cssPending.operation,
    leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
  }
  await credentials.replaceVersionedRow(
    `provisioning-operation-${expiredOperation.idempotencyKeyHash}`,
    expiredOperation,
    cssPending.etag
  )
  const reloaded = await store.findByIdempotencyKey('signup-request-1')
  assert.ok(reloaded)

  await assert.rejects(
    store.acquireLease(reloaded, 'worker-b', 60_000),
    (error: unknown) => error instanceof ProvisioningConflictError && error.code === 'lease_lost'
  )
  const manualReview = await store.findByIdempotencyKey('signup-request-1')
  assert.equal(manualReview?.operation.state, 'manual_review')
  assert.equal(manualReview?.operation.manualReviewReason, 'css_account_result_unknown')
})

void test('file backend preserves operations, reservations, and encrypted resume material', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nz-provisioning-store-'))
  const filePath = join(dir, 'credentials.json')
  try {
    const first = new ProvisioningStore(new CredentialStore({ encryptionKey: KEY_B64, filePath }))
    const reserved = await first.reserveOrLoad(reservationInput())

    const second = new ProvisioningStore(new CredentialStore({ encryptionKey: KEY_B64, filePath }))
    const reloaded = await second.findByIdempotencyKey('signup-request-1')
    assert.ok(reloaded)
    assert.equal(reloaded?.operation.operationId, reserved.operation.operationId)
    assert.deepEqual(second.decryptResumeMaterial(reloaded.operation), {
      cssPassword: 'one-time-secret',
      proof: { pi_a: ['1', '2'] },
    })
    await assert.rejects(
      second.reserveOrLoad(
        reservationInput({
          idempotencyKey: 'signup-request-after-restart',
          requestDigest: 'f'.repeat(64),
          normalizedEmail: 'restart@example.com',
        })
      ),
      (error: unknown) =>
        error instanceof ProvisioningConflictError && error.code === 'reservation_conflict'
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

void test('file backend permits only one concurrent claimant for the same handle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nz-provisioning-race-'))
  const filePath = join(dir, 'credentials.json')
  try {
    const first = new ProvisioningStore(new CredentialStore({ encryptionKey: KEY_B64, filePath }))
    const second = new ProvisioningStore(new CredentialStore({ encryptionKey: KEY_B64, filePath }))
    const results = await Promise.allSettled([
      first.reserveOrLoad(
        reservationInput({
          idempotencyKey: 'race-1',
          requestDigest: '1'.repeat(64),
        })
      ),
      second.reserveOrLoad(
        reservationInput({
          idempotencyKey: 'race-2',
          requestDigest: '2'.repeat(64),
          normalizedEmail: 'race-2@example.com',
          expectedWebId: 'https://solid.nodezero.social/race-2/profile/card#me',
          expectedPodUrl: 'https://solid.nodezero.social/race-2/',
        })
      ),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const rejected = results.find((result) => result.status === 'rejected')
    assert.ok(rejected && rejected.status === 'rejected')
    assert.ok(rejected.reason instanceof ProvisioningConflictError)
    assert.equal(rejected.reason.code, 'reservation_conflict')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

void test('credential commit can scrub temporary password and client secret checkpoints', async () => {
  const store = new ProvisioningStore(new CredentialStore({ encryptionKey: KEY_B64 }))
  const reserved = await store.reserveOrLoad(reservationInput())
  const acquired = await store.acquireLease(reserved, 'worker-a', 60_000)
  const proofVerified = await store.transition(acquired.operation, acquired.lease, 'proof_verified')
  const cssPending = await store.transition(proofVerified, acquired.lease, 'css_account_pending')
  const cssCreated = await store.transition(cssPending, acquired.lease, 'css_account_created', {
    resumeMaterial: {
      password: 'one-time-secret',
      account: {
        webId: reserved.operation.expectedWebId,
        podUrl: reserved.operation.expectedPodUrl,
        clientCredentialsId: 'client-id',
        clientCredentialsSecret: 'client-secret',
      },
    },
  })
  const loginCreated = await store.transition(cssCreated, acquired.lease, 'css_login_created')
  const podCreated = await store.transition(loginCreated, acquired.lease, 'pod_created')
  const clientCredentialsCreated = await store.transition(
    podCreated,
    acquired.lease,
    'client_credentials_created'
  )
  const lockboxReady = await store.transition(
    clientCredentialsCreated,
    acquired.lease,
    'lockbox_ready'
  )
  const committed = await store.transition(lockboxReady, acquired.lease, 'credential_committed', {
    resumeMaterial: {
      account: {
        webId: reserved.operation.expectedWebId,
        podUrl: reserved.operation.expectedPodUrl,
      },
    },
  })

  const checkpoint = store.decryptResumeMaterial<Record<string, unknown>>(committed.operation)
  assert.equal('password' in checkpoint, false)
  assert.deepEqual(checkpoint.account, {
    webId: reserved.operation.expectedWebId,
    podUrl: reserved.operation.expectedPodUrl,
  })
  assert.equal(JSON.stringify(checkpoint).includes('client-secret'), false)
})
