import AsyncStorage from '@react-native-async-storage/async-storage'

export interface ContentPreferences {
  showNsfw: boolean
}

export const SHOW_NSFW_KEY = 'settings.showNsfw'

export const DEFAULT_CONTENT_PREFERENCES: ContentPreferences = {
  showNsfw: false,
}

export async function readContentPreferences(): Promise<ContentPreferences> {
  const raw = await AsyncStorage.getItem(SHOW_NSFW_KEY)
  if (raw === null) return DEFAULT_CONTENT_PREFERENCES
  return {
    showNsfw: raw === 'true',
  }
}

export async function writeContentPreferences(preferences: ContentPreferences): Promise<void> {
  await AsyncStorage.setItem(SHOW_NSFW_KEY, String(preferences.showNsfw))
}
