import type { DirectoryEntry, DirectoryRecord } from './types'
import { deriveNameFromWebId } from './webIdName'

export function buildDirectoryEntry(args: {
  candidateWebId: string
  effectiveWebId: string
  connections: string[]
  profileDisplayName?: string
  directoryRecord?: DirectoryRecord
}): DirectoryEntry {
  const {
    candidateWebId,
    effectiveWebId,
    connections,
    profileDisplayName,
    directoryRecord,
  } = args

  const displayName =
    profileDisplayName?.trim() ||
    directoryRecord?.displayName?.trim() ||
    deriveNameFromWebId(candidateWebId)

  return {
    webId: candidateWebId,
    displayName,
    source: candidateWebId === effectiveWebId ? 'self' : connections.includes(candidateWebId) ? 'connection' : 'directory',
    verified: directoryRecord?.trustSignals?.verified === true,
  }
}
