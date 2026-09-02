import { strict as assert } from 'node:assert'
import { webcrypto } from 'node:crypto'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import {
  checkWebAuthnPrfSupport,
  deriveKeyFromPrfSecret,
  WebAuthnPrfKeyProvider,
  createHardwareBoundSecureStore,
} from './WebAuthnPrfStore.js'

void test('checkWebAuthnPrfSupport reports false in non-browser environment', async () => {
  const caps = await checkWebAuthnPrfSupport()
  assert.equal(caps.prfSupported, false)
  assert.equal(caps.platformAuthenticatorAvailable, false)
})

void test('checkWebAuthnPrfSupport detects PRF capability when available', async () => {
  const mockPubKeyCred = {
    isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    getClientCapabilities: async () => ({ prf: true }),
  } as unknown as typeof PublicKeyCredential

  const mockCredentials = {} as CredentialsContainer

  const caps = await checkWebAuthnPrfSupport({
    publicKeyCredentialClass: mockPubKeyCred,
    credentialsContainer: mockCredentials,
  })

  assert.equal(caps.prfSupported, true)
  assert.equal(caps.platformAuthenticatorAvailable, true)
  assert.match(caps.details ?? '', /supported/i)
})

void test('deriveKeyFromPrfSecret produces a valid AES-GCM CryptoKey', async () => {
  const prfSecret = new Uint8Array(32).fill(0x42)
  const key = await deriveKeyFromPrfSecret(
    prfSecret,
    'staging-testnet',
    webcrypto as unknown as Crypto,
  )

  assert.ok(key)
  assert.equal(key.algorithm.name, 'AES-GCM')
  assert.equal(key.extractable, false)
  assert.deepEqual(key.usages, ['encrypt', 'decrypt'])
})

void test('WebAuthnPrfKeyProvider caches PRF derived key and protects records', async () => {
  const indexedDB = new IDBFactory()
  const prfSecret = new Uint8Array(32).fill(0x99)
  const provider = new WebAuthnPrfKeyProvider({
    profile: 'staging-testnet',
    crypto: webcrypto as unknown as Crypto,
  })

  assert.equal(provider.isHardwareProtected(), false)
  await provider.setPrfSecret(prfSecret)
  assert.equal(provider.isHardwareProtected(), true)

  const store = createHardwareBoundSecureStore(
    {
      profile: 'staging-testnet',
      indexedDB,
      crypto: webcrypto as unknown as Crypto,
    },
    provider,
  )

  await store.setItemAsync('hardware_secret', 'BIO-PROTECTED-STELLAR-KEY')
  const retrieved = await store.getItemAsync('hardware_secret')
  assert.equal(retrieved, 'BIO-PROTECTED-STELLAR-KEY')
})

void test('NC-03: an unbound hardware store refuses writes instead of silently downgrading', async () => {
  const indexedDB = new IDBFactory()
  const store = createHardwareBoundSecureStore({
    profile: 'staging-testnet',
    indexedDB,
    crypto: webcrypto as unknown as Crypto,
  })

  await assert.rejects(
    store.setItemAsync('standard_secret', 'FALLBACK-STELLAR-KEY'),
    /not unlocked/i,
    'a store without a PRF secret must not quietly generate a software key'
  )
})

void test('software wrapping is reachable only via explicit opt-in', async () => {
  const indexedDB = new IDBFactory()
  const store = createHardwareBoundSecureStore({
    profile: 'staging-testnet',
    indexedDB,
    crypto: webcrypto as unknown as Crypto,
    allowSoftwareFallback: true,
  })

  await store.setItemAsync('standard_secret', 'FALLBACK-STELLAR-KEY')
  assert.equal(await store.getItemAsync('standard_secret'), 'FALLBACK-STELLAR-KEY')
})
