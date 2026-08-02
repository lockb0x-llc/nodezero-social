import Constants from 'expo-constants'
import {
  isLikelyWebId,
  buildDirectoryPageUrl,
  parseDirectoryPage,
  parseDirectoryRecords,
  resolveDirectoryEndpointFromExtra,
} from './directorySourceShared'

export { deriveNameFromWebId } from './webIdName'
export {
  buildDirectoryPageUrl,
  isLikelyWebId,
  parseDirectoryPage,
  parseDirectoryRecords,
  resolveDirectoryEndpointFromExtra,
}

export function resolveDirectoryEndpoint(): string {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  return resolveDirectoryEndpointFromExtra(appExtra)
}
