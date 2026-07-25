import Constants from 'expo-constants'
import { deriveNameFromWebId } from './webIdName'
import {
  isLikelyWebId,
  parseDirectoryRecords,
  resolveDirectoryEndpointFromExtra,
} from './directorySourceShared'

export { deriveNameFromWebId } from './webIdName'
export { isLikelyWebId, parseDirectoryRecords, resolveDirectoryEndpointFromExtra }

export function resolveDirectoryEndpoint(): string {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  return resolveDirectoryEndpointFromExtra(appExtra)
}
