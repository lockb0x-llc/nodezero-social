import AsyncStorage from '@react-native-async-storage/async-storage'
import { createTrustCircleStore, type TrustCircleStoreOptions } from './trustCirclePersistence'

const TRUST_CIRCLE_PREFIX = 'nodezero.trust-circle.v1:'

function storageKey(ownerWebId: string): string {
  return `${TRUST_CIRCLE_PREFIX}${ownerWebId}`
}

async function readMembers(ownerWebId: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(storageKey(ownerWebId))
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

async function writeMembers(ownerWebId: string, members: string[]): Promise<void> {
  const unique = Array.from(new Set(members)).sort((a, b) => a.localeCompare(b))
  await AsyncStorage.setItem(storageKey(ownerWebId), JSON.stringify(unique))
}

const podBackedStore = createTrustCircleStore({
  readLocal: readMembers,
  writeLocal: writeMembers,
})

export async function listTrustCircleMembers(
  ownerWebId: string,
  options: TrustCircleStoreOptions = {}
): Promise<string[]> {
  return podBackedStore.list(ownerWebId, options)
}

export async function addTrustCircleMember(
  ownerWebId: string,
  targetWebId: string,
  options: TrustCircleStoreOptions = {}
): Promise<string[]> {
  return podBackedStore.add(ownerWebId, targetWebId, options)
}

export async function removeTrustCircleMember(
  ownerWebId: string,
  targetWebId: string,
  options: TrustCircleStoreOptions = {}
): Promise<string[]> {
  return podBackedStore.remove(ownerWebId, targetWebId, options)
}

export async function hasTrustCircleMember(
  ownerWebId: string,
  targetWebId: string,
  options: TrustCircleStoreOptions = {}
): Promise<boolean> {
  return podBackedStore.has(ownerWebId, targetWebId, options)
}
