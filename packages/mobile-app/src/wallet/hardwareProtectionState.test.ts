import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  clearHardwareProtectionState,
  readHardwareProtectionState,
  writeHardwareProtectionState,
  type KeyValueStorage,
} from './hardwareProtectionState'

function memoryStorage(seed?: string): KeyValueStorage {
  const map = new Map<string, string>()
  if (seed !== undefined) map.set('nodezero.wallet.hardware-protection.v1', seed)
  return {
    getItem: (key) => Promise.resolve(map.get(key) ?? null),
    setItem: (key, value) => {
      map.set(key, value)
      return Promise.resolve()
    },
    removeItem: (key) => {
      map.delete(key)
      return Promise.resolve()
    },
  }
}

void test('an absent record reads as disabled', async () => {
  assert.deepEqual(await readHardwareProtectionState(memoryStorage()), {
    enabled: false,
    record: null,
  })
})

void test('round-trips an enabled state with its passkey record', async () => {
  const storage = memoryStorage()
  await writeHardwareProtectionState(
    { enabled: true, record: { credentialId: 'abc123', createdAt: '2026-09-02T00:00:00.000Z' } },
    storage
  )

  const state = await readHardwareProtectionState(storage)
  assert.equal(state.enabled, true)
  assert.equal(state.record?.credentialId, 'abc123')
})

void test('NC-03: an enabled flag without a credential is treated as disabled', async () => {
  // Otherwise the app would claim protection it cannot actually unlock.
  const storage = memoryStorage(JSON.stringify({ enabled: true, record: null }))

  assert.deepEqual(await readHardwareProtectionState(storage), { enabled: false, record: null })
})

void test('corrupt persisted state degrades to disabled rather than throwing', async () => {
  assert.deepEqual(await readHardwareProtectionState(memoryStorage('not-json')), {
    enabled: false,
    record: null,
  })
})

void test('clearing removes the enabled flag', async () => {
  const storage = memoryStorage()
  await writeHardwareProtectionState(
    { enabled: true, record: { credentialId: 'abc123', createdAt: '2026-09-02T00:00:00.000Z' } },
    storage
  )
  await clearHardwareProtectionState(storage)

  assert.equal((await readHardwareProtectionState(storage)).enabled, false)
})
