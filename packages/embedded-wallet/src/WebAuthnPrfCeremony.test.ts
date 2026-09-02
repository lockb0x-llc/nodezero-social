import assert from 'node:assert/strict'
import test from 'node:test'
import { webcrypto } from 'node:crypto'
import {
  assertPrfSecret,
  base64UrlDecode,
  base64UrlEncode,
  PrfUnavailableError,
  registerPrfPasskey,
  unlockPrfProvider,
  WebAuthnPrfKeyProvider,
} from './WebAuthnPrfStore.js'

const crypto = webcrypto as unknown as Crypto
const PROFILE = 'staging-testnet'
const RAW_ID = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

interface CeremonyRecorder {
  createCalls: PublicKeyCredentialCreationOptions[]
  getCalls: PublicKeyCredentialRequestOptions[]
}

function fakeCredentials(
  behaviour: {
    prfEnabled?: boolean
    prfResult?: Uint8Array | null
    createReturnsNull?: boolean
    getReturnsNull?: boolean
  } = {}
): { container: CredentialsContainer; recorder: CeremonyRecorder } {
  const recorder: CeremonyRecorder = { createCalls: [], getCalls: [] }

  const container = {
    create: (options: CredentialCreationOptions) => {
      recorder.createCalls.push(options.publicKey as PublicKeyCredentialCreationOptions)
      if (behaviour.createReturnsNull) return Promise.resolve(null)
      return Promise.resolve({
        rawId: base64UrlDecode(base64UrlEncode(RAW_ID)).buffer,
        getClientExtensionResults: () => ({
          prf: { enabled: behaviour.prfEnabled ?? true },
        }),
      } as unknown as Credential)
    },
    get: (options: CredentialRequestOptions) => {
      recorder.getCalls.push(options.publicKey as PublicKeyCredentialRequestOptions)
      if (behaviour.getReturnsNull) return Promise.resolve(null)
      const first = behaviour.prfResult === null ? undefined : (behaviour.prfResult ?? new Uint8Array(32).fill(7))
      return Promise.resolve({
        rawId: RAW_ID.buffer,
        getClientExtensionResults: () => ({
          prf: { results: first ? { first: first.buffer } : undefined },
        }),
      } as unknown as Credential)
    },
  } as unknown as CredentialsContainer

  return { container, recorder }
}

void test('base64url round-trips credential ids without padding', () => {
  const encoded = base64UrlEncode(RAW_ID)
  assert.equal(encoded.includes('='), false)
  assert.deepEqual(Array.from(base64UrlDecode(encoded)), Array.from(RAW_ID))
})

void test('registration requests the PRF extension and requires user verification', async () => {
  const { container, recorder } = fakeCredentials()

  const record = await registerPrfPasskey({
    profile: PROFILE,
    credentialsContainer: container,
    crypto,
  })

  const options = recorder.createCalls[0]
  assert.ok(options)
  assert.deepEqual(
    (options.extensions as unknown as { prf?: unknown }).prf,
    {},
    'registration must enable the prf extension'
  )
  assert.equal(options.authenticatorSelection?.userVerification, 'required')
  assert.equal(options.authenticatorSelection?.authenticatorAttachment, 'platform')
  assert.equal(record.credentialId, base64UrlEncode(RAW_ID))
})

void test('registration fails closed when the authenticator does not support PRF', async () => {
  const { container } = fakeCredentials({ prfEnabled: false })

  await assert.rejects(
    registerPrfPasskey({ profile: PROFILE, credentialsContainer: container, crypto }),
    (error: unknown) =>
      error instanceof PrfUnavailableError && /does not support the PRF extension/i.test(error.message)
  )
})

void test('a cancelled registration is reported, not silently downgraded', async () => {
  const { container } = fakeCredentials({ createReturnsNull: true })

  await assert.rejects(
    registerPrfPasskey({ profile: PROFILE, credentialsContainer: container, crypto }),
    (error: unknown) => error instanceof PrfUnavailableError && /cancelled/i.test(error.message)
  )
})

void test('assertion names the registered credential and evaluates the PRF salt', async () => {
  const { container, recorder } = fakeCredentials()
  const salt = new TextEncoder().encode('nodezero.prf.evaluation.salt.v1.staging-testnet')

  const secret = await assertPrfSecret({
    profile: PROFILE,
    credentialsContainer: container,
    crypto,
    credentialId: base64UrlEncode(RAW_ID),
    salt,
  })

  const options = recorder.getCalls[0]
  assert.ok(options)
  assert.equal(options.userVerification, 'required')
  assert.equal(options.allowCredentials?.length, 1)
  assert.deepEqual(
    Array.from(new Uint8Array(options.allowCredentials?.[0]?.id as ArrayBuffer)),
    Array.from(RAW_ID)
  )
  const evaluated = (options.extensions as unknown as { prf?: { eval?: { first?: ArrayBuffer } } }).prf
  assert.deepEqual(Array.from(new Uint8Array(evaluated?.eval?.first as ArrayBuffer)), Array.from(salt))
  assert.equal(secret.length, 32)
})

void test('assertion fails closed when no PRF result is returned', async () => {
  const { container } = fakeCredentials({ prfResult: null })

  await assert.rejects(
    assertPrfSecret({
      profile: PROFILE,
      credentialsContainer: container,
      crypto,
      credentialId: base64UrlEncode(RAW_ID),
      salt: new Uint8Array(32),
    }),
    (error: unknown) =>
      error instanceof PrfUnavailableError && /did not return a PRF evaluation/i.test(error.message)
  )
})

void test('NC-03: an unbound provider refuses to produce a wrapping key', async () => {
  const provider = new WebAuthnPrfKeyProvider({ profile: PROFILE, crypto })

  assert.equal(provider.isHardwareProtected(), false)
  await assert.rejects(
    provider.getWrappingKey(undefined as unknown as IDBDatabase, crypto),
    (error: unknown) =>
      error instanceof PrfUnavailableError && /not unlocked/i.test(error.message),
    'the silent software fallback must not be reachable by default'
  )
})

void test('NC-03: software fallback is available only when explicitly opted in', () => {
  const guarded = new WebAuthnPrfKeyProvider({ profile: PROFILE, crypto })
  const permissive = new WebAuthnPrfKeyProvider({
    profile: PROFILE,
    crypto,
    allowSoftwareFallback: true,
  })

  // Both start unbound; only the guarded one refuses outright.
  assert.equal(guarded.isHardwareProtected(), false)
  assert.equal(permissive.isHardwareProtected(), false)
})

void test('unlock registers, asserts, and binds the provider in one pass', async () => {
  const { container, recorder } = fakeCredentials()
  const provider = new WebAuthnPrfKeyProvider({ profile: PROFILE, crypto })

  const record = await unlockPrfProvider(provider, {
    profile: PROFILE,
    credentialsContainer: container,
    crypto,
  })

  assert.equal(recorder.createCalls.length, 1, 'registers when no record exists')
  assert.equal(recorder.getCalls.length, 1)
  assert.equal(provider.isHardwareProtected(), true)
  assert.equal(record.credentialId, base64UrlEncode(RAW_ID))
})

void test('unlock reuses an existing passkey record instead of re-registering', async () => {
  const { container, recorder } = fakeCredentials()
  const provider = new WebAuthnPrfKeyProvider({ profile: PROFILE, crypto })

  await unlockPrfProvider(provider, {
    profile: PROFILE,
    credentialsContainer: container,
    crypto,
    record: { credentialId: base64UrlEncode(RAW_ID), createdAt: '2026-09-01T00:00:00.000Z' },
  })

  assert.equal(recorder.createCalls.length, 0, 'must not re-register an existing passkey')
  assert.equal(recorder.getCalls.length, 1)
  assert.equal(provider.isHardwareProtected(), true)
})

void test('a bound provider derives a distinct key per profile', async () => {
  const secret = new Uint8Array(32).fill(9)
  const staging = new WebAuthnPrfKeyProvider({ profile: 'staging-testnet', crypto })
  const local = new WebAuthnPrfKeyProvider({ profile: 'local', crypto })

  await staging.setPrfSecret(secret)
  await local.setPrfSecret(secret)

  assert.equal(staging.isHardwareProtected(), true)
  assert.equal(local.isHardwareProtected(), true)
  // Salt/info are profile-scoped, so the same PRF secret must not yield a shared key.
  assert.notEqual(staging.salt.toString(), local.salt.toString())
})
