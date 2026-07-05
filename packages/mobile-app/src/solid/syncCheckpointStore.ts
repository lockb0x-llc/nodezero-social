import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  createSyncState,
  deserializeSyncState,
  serializeSyncState,
  type SyncState,
  type SerializedSyncState,
} from '@nodezero/solid-pod-sync'

const SYNC_CHECKPOINT_KEY_PREFIX = 'solid.sync.v1:'

function checkpointKey(webId: string, scope: string): string {
  return `${SYNC_CHECKPOINT_KEY_PREFIX}${scope}:${webId}`
}

export async function loadSyncCheckpoint(webId: string, scope: string): Promise<SyncState> {
  try {
    const raw = await AsyncStorage.getItem(checkpointKey(webId, scope))
    if (!raw) return createSyncState()

    const parsed = JSON.parse(raw) as SerializedSyncState
    return deserializeSyncState(parsed)
  } catch {
    await AsyncStorage.removeItem(checkpointKey(webId, scope))
    return createSyncState()
  }
}

export async function saveSyncCheckpoint(webId: string, scope: string, state: SyncState): Promise<void> {
  const serialized = serializeSyncState(state)
  await AsyncStorage.setItem(checkpointKey(webId, scope), JSON.stringify(serialized))
}

export async function clearSyncCheckpoint(webId: string, scope: string): Promise<void> {
  await AsyncStorage.removeItem(checkpointKey(webId, scope))
}

export async function loadFeedSyncCheckpoint(webId: string): Promise<SyncState> {
  return loadSyncCheckpoint(webId, 'feed')
}

export async function saveFeedSyncCheckpoint(webId: string, state: SyncState): Promise<void> {
  await saveSyncCheckpoint(webId, 'feed', state)
}

export async function clearFeedSyncCheckpoint(webId: string): Promise<void> {
  await clearSyncCheckpoint(webId, 'feed')
}