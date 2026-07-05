import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  createSyncState,
  deserializeSyncState,
  serializeSyncState,
  type SyncState,
  type SerializedSyncState,
} from '@nodezero/solid-pod-sync'

const FEED_SYNC_CHECKPOINT_KEY_PREFIX = 'solid.feed.sync.v1:'

function checkpointKey(webId: string): string {
  return `${FEED_SYNC_CHECKPOINT_KEY_PREFIX}${webId}`
}

export async function loadFeedSyncCheckpoint(webId: string): Promise<SyncState> {
  try {
    const raw = await AsyncStorage.getItem(checkpointKey(webId))
    if (!raw) return createSyncState()

    const parsed = JSON.parse(raw) as SerializedSyncState
    return deserializeSyncState(parsed)
  } catch {
    await AsyncStorage.removeItem(checkpointKey(webId))
    return createSyncState()
  }
}

export async function saveFeedSyncCheckpoint(webId: string, state: SyncState): Promise<void> {
  const serialized = serializeSyncState(state)
  await AsyncStorage.setItem(checkpointKey(webId), JSON.stringify(serialized))
}

export async function clearFeedSyncCheckpoint(webId: string): Promise<void> {
  await AsyncStorage.removeItem(checkpointKey(webId))
}