import AsyncStorage from '@react-native-async-storage/async-storage'

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

export async function listTrustCircleMembers(ownerWebId: string): Promise<string[]> {
  return readMembers(ownerWebId)
}

export async function addTrustCircleMember(ownerWebId: string, targetWebId: string): Promise<string[]> {
  const members = await readMembers(ownerWebId)
  if (!members.includes(targetWebId)) {
    members.push(targetWebId)
    await writeMembers(ownerWebId, members)
  }
  return members
}

export async function removeTrustCircleMember(ownerWebId: string, targetWebId: string): Promise<string[]> {
  const members = await readMembers(ownerWebId)
  const updated = members.filter((member) => member !== targetWebId)
  await writeMembers(ownerWebId, updated)
  return updated
}

export async function hasTrustCircleMember(ownerWebId: string, targetWebId: string): Promise<boolean> {
  const members = await readMembers(ownerWebId)
  return members.includes(targetWebId)
}
