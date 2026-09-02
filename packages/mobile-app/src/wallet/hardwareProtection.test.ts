import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { webcrypto } from 'node:crypto'
import { IDBFactory } from 'fake-indexeddb'
import {
  enableHardwareProtection,
  HardwareProtectionUnsupportedError,
  KEYRING_INDEX_KEY,
  migrateWalletRecords,
  unlockHardwareProtection,
  walletRecordKeys,
  type HardwareProtectionState,
} from './hardwareProtection'

const crypto = webcrypto as unknown as Crypto
const PROFILE = 'staging-testnet'
const RAW_ID = new Uint8Array([9, 8, 7, 6])

function fakeCredentials(): CredentialsContainer {
  return {
    create: () =>
      Promise.resolve({
        rawId: RAW_ID.buffer,
        getClientExtensionResults: () => ({ prf: { enabled: true } }),
      } as unknown as Credential),
    get: () =>
      Promise.resolve({
        rawId: RAW_ID.buffer,
        getClientExtensionResults: () => ({
          prf: { results: { first: new Uint8Array(32).fill(3).buffer } },
        }),
      } as unknown as Credential),
  } as unknown as CredentialsContainer
}

/** WebAuthn capability probing reads these off the global. */
function withPlatformSupport<T>(prfSupported: boolean, run: () => T): T {
  const globalRef = globalThis as unknown as { PublicKeyCredential?: unknown }
  const original = globalRef.PublicKeyCredential
  globalRef.PublicKeyCredential = {
    isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true),
    getClientCapabilities: () => Promise.resolve({ prf: prfSupported }),
  }
  try {
    return run()
  } finally {
    globalRef.PublicKeyCredential = original
  }
}

function stateStore() {
  let state: HardwareProtectionState = { enabled: false, record: null }
  return {
    readState: () => Promise.resolve(state),
    writeState: (next: HardwareProtectionState) => {
      state = next
      return Promise.resolve()
    },
    current: () => state,
  }
}

void test('walletRecordKeys always includes the keyring index', () => {
  assert.deepEqual(walletRecordKeys(['key-a', 'key-b']), [KEYRING_INDEX_KEY, 'key-a', 'key-b'])
})

void test('migration re-encrypts every readable record into the target store', async () => {
  const written = new Map<string, string>()
  const target = {
    getItemAsync: (k: string) => Promise.resolve(written.get(k) ?? null),
    setItemAsync: (k: string, v: string) => {
      written.set(k, v)
      return Promise.resolve()
    },
    deleteItemAsync: () => Promise.resolve(),
  }

  const result = await migrateWalletRecords(
    {
      keys: [KEYRING_INDEX_KEY, 'identity-1', 'identity-2'],
      read: (key) => Promise.resolve(key === 'identity-2' ? null : `secret:${key}`),
    },
    target
  )

  assert.equal(result.migrated, 2)
  assert.deepEqual(result.skipped, [])
  assert.equal(written.get('identity-1'), 'secret:identity-1')
  assert.equal(written.has('identity-2'), false, 'absent records are not written')
})

void test('an unreadable record is skipped rather than stranding the whole keyring', async () => {
  const written = new Map<string, string>()
  const target = {
    getItemAsync: (k: string) => Promise.resolve(written.get(k) ?? null),
    setItemAsync: (k: string, v: string) => {
      written.set(k, v)
      return Promise.resolve()
    },
    deleteItemAsync: () => Promise.resolve(),
  }

  const result = await migrateWalletRecords(
    {
      keys: ['good', 'corrupt', 'also-good'],
      read: (key) =>
        key === 'corrupt'
          ? Promise.reject(new Error('cannot authenticate record'))
          : Promise.resolve(`secret:${key}`),
    },
    target
  )

  assert.equal(result.migrated, 2)
  assert.deepEqual(result.skipped, ['corrupt'])
  assert.equal(written.get('also-good'), 'secret:also-good')
})

void test('NC-03: enabling protection migrates records and persists the passkey record', async () => {
  await withPlatformSupport(true, async () => {
    const state = stateStore()
    const indexedDB = new IDBFactory()
    const deps = {
      profile: PROFILE,
      indexedDB,
      crypto,
      credentialsContainer: fakeCredentials(),
      readState: state.readState,
      writeState: state.writeState,
    }

    const result = await enableHardwareProtection(deps, [])

    assert.equal(state.current().enabled, true)
    assert.equal(state.current().record?.credentialId, result.record.credentialId)
    assert.equal(typeof result.migrated, 'number')
  })
})

void test('NC-03: enabling is refused when the platform does not report PRF', async () => {
  await withPlatformSupport(false, async () => {
    const state = stateStore()
    const deps = {
      profile: PROFILE,
      indexedDB: new IDBFactory(),
      crypto,
      credentialsContainer: fakeCredentials(),
      readState: state.readState,
      writeState: state.writeState,
    }

    await assert.rejects(
      enableHardwareProtection(deps, []),
      (error: unknown) => error instanceof HardwareProtectionUnsupportedError
    )
    assert.equal(state.current().enabled, false, 'a failed enable must not claim protection')
  })
})

void test('NC-03: unlocking refuses when protection was never enabled', async () => {
  const state = stateStore()
  const deps = {
    profile: PROFILE,
    indexedDB: new IDBFactory(),
    crypto,
    credentialsContainer: fakeCredentials(),
    readState: state.readState,
    writeState: state.writeState,
  }

  await assert.rejects(unlockHardwareProtection(deps), /not enabled on this device/i)
})

void test('NC-03: a store unlocked via passkey round-trips a wallet secret', async () => {
  await withPlatformSupport(true, async () => {
    const state = stateStore()
    const indexedDB = new IDBFactory()
    const deps = {
      profile: PROFILE,
      indexedDB,
      crypto,
      credentialsContainer: fakeCredentials(),
      readState: state.readState,
      writeState: state.writeState,
    }

    await enableHardwareProtection(deps, [])
    const { store } = await unlockHardwareProtection(deps)

    await store.setItemAsync('identity-1', 'SXXXXXXXXSECRET')
    assert.equal(await store.getItemAsync('identity-1'), 'SXXXXXXXXSECRET')
  })
})
