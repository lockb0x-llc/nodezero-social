import type { DirectoryEntry, DirectoryRecord } from './types'
import { deriveNameFromWebId } from './webIdName'

export function buildDirectoryEntry(args: {
  candidateWebId: string
  effectiveWebId: string
  connections: string[]
  acceptedRelationships?: string[]
  profileDisplayName?: string
  directoryRecord?: DirectoryRecord
  localPublicInterests?: string[]
}): DirectoryEntry {
  const {
    candidateWebId,
    effectiveWebId,
    connections,
    acceptedRelationships = connections,
    profileDisplayName,
    directoryRecord,
    localPublicInterests = [],
  } = args

  const displayName =
    profileDisplayName?.trim() ||
    directoryRecord?.displayName?.trim() ||
    deriveNameFromWebId(candidateWebId)

  const publicInterests = directoryRecord?.publicInterests ?? []
  const localInterestSet = new Set(localPublicInterests.map((value) => value.trim().toLowerCase()))
  const hasSharedPublicInterest = publicInterests.some((value) =>
    localInterestSet.has(value.trim().toLowerCase())
  )
  const recommendationReasons =
    candidateWebId === effectiveWebId
      ? ['self' as const]
      : acceptedRelationships.includes(candidateWebId)
        ? ['accepted-relationship' as const]
        : connections.includes(candidateWebId) && !directoryRecord
          ? ['legacy-contact' as const]
          : hasSharedPublicInterest
            ? ['shared-public-interest' as const]
            : ['public-directory' as const]

  return {
    webId: candidateWebId,
    displayName,
    ...(directoryRecord?.avatarUrl ? { avatarUrl: directoryRecord.avatarUrl } : {}),
    source:
      candidateWebId === effectiveWebId
        ? 'self'
        : connections.includes(candidateWebId)
          ? 'connection'
          : 'directory',
    verified: directoryRecord?.trustSignals?.verified === true,
    publicInterests,
    recommendationReasons,
  }
}

export function directoryRecommendationRank(entry: DirectoryEntry): number {
  const primary = entry.recommendationReasons[0]
  if (primary === 'self') return 0
  if (primary === 'accepted-relationship') return 1
  if (primary === 'legacy-contact') return 2
  if (primary === 'shared-public-interest') return 2
  return 3
}
